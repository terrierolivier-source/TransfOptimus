import React, { useMemo, useRef, useEffect, useState } from 'react';
import { AppState, MissionStatus, Country, BillingMode, Mission, PlanningEntry, TimesheetStatus } from '../types';
import { syncMissionToCloud } from '../services/dataService';
import { 
  format, 
  startOfWeek, 
  addWeeks, 
  addMonths, 
  addQuarters, 
  eachWeekOfInterval, 
  eachMonthOfInterval, 
  eachQuarterOfInterval, 
  differenceInWeeks, 
  differenceInMonths, 
  differenceInQuarters, 
  startOfToday, 
  isSameWeek, 
  isSameMonth, 
  isSameQuarter, 
  parseISO, 
  isAfter, 
  isBefore, 
  startOfMonth, 
  startOfQuarter, 
  isValid,
  differenceInDays,
  addDays,
  endOfWeek,
  endOfMonth
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Search, 
  ChevronDown,
  ChevronUp,
  FilterX,
  CalendarDays,
  Sun,
  Cloud,
  CloudRain,
  CloudLightning,
  CalendarRange,
  CalendarClock,
  Filter
} from 'lucide-react';
import { getBusinessDays, getFiscalYear } from '../utils';

interface PlanningProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

type TimeScale = 'week' | 'month' | 'quarter';
type SortKey = 'clientName' | 'startDate' | 'endDate';
type StatusFilterType = MissionStatus | 'All' | 'Active';

const WEATHER_ICONS: Record<string, any> = {
  sun: { icon: Sun, color: 'text-yellow-400' },
  cloud: { icon: Cloud, color: 'text-gray-300' },
  rain: { icon: CloudRain, color: 'text-blue-300' },
  storm: { icon: CloudLightning, color: 'text-purple-400' },
};

const Planning: React.FC<PlanningProps> = ({ state, updateState }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const today = startOfToday();
  
  const [timeScale, setTimeScale] = useState<TimeScale>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('Active');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ 
    key: 'clientName', 
    direction: 'asc' 
  });
  
  const [startDateStr, setStartDateStr] = useState('2025-02-01');
  const [endDateStr, setEndDateStr] = useState('2027-03-04');

  const [expandedMissions, setExpandedMissions] = useState<Set<string>>(new Set());
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  const [resizing, setResizing] = useState<{
    id: string;
    direction: 'left' | 'right';
    initialMouseX: number;
    initialDate: string;
    currentDate: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const viewStartDate = useMemo(() => {
    const d = parseISO(startDateStr);
    return isValid(d) ? d : parseISO('2025-02-01');
  }, [startDateStr]);

  const viewEndDate = useMemo(() => {
    const d = parseISO(endDateStr);
    return isValid(d) ? d : addMonths(today, 12);
  }, [endDateStr, today]);

  const scaleConfig = {
    week: { 
      colWidth: 120, 
      daysInUnit: 7,
      getStart: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }), 
      isCurrent: (d: Date) => isSameWeek(d, today, { weekStartsOn: 1 }), 
      getDiff: (s: Date, e: Date) => differenceInWeeks(e, s), 
      getInterval: (s: Date, e: Date) => eachWeekOfInterval({ start: s, end: e }, { weekStartsOn: 1 }),
      getLabel: (d: Date) => `S${format(d, 'w')}`
    },
    month: { 
      colWidth: 180, 
      daysInUnit: 30.44, 
      getStart: (d: Date) => startOfMonth(d), 
      isCurrent: (d: Date) => isSameMonth(d, today), 
      getDiff: (s: Date, e: Date) => differenceInMonths(e, s), 
      getInterval: (s: Date, e: Date) => eachMonthOfInterval({ start: s, end: e }),
      getLabel: (d: Date) => format(d, 'MMM yyyy', { locale: fr })
    },
    quarter: { 
      colWidth: 280, 
      daysInUnit: 91.25, 
      getStart: (d: Date) => startOfQuarter(d), 
      isCurrent: (d: Date) => isSameQuarter(d, today), 
      getDiff: (s: Date, e: Date) => differenceInQuarters(e, s), 
      getInterval: (s: Date, e: Date) => eachQuarterOfInterval({ start: s, end: e }),
      getLabel: (d: Date) => {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `T${q} ${d.getFullYear()}`;
      }
    }
  };

  const config = scaleConfig[timeScale];
  const startDate = config.getStart(viewStartDate);
  const endDate = viewEndDate;
  
  const timeColumns = useMemo(() => {
    try {
      if (isAfter(startDate, endDate)) return [startDate];
      return config.getInterval(startDate, endDate);
    } catch(e) {
      return [startDate];
    }
  }, [startDate, endDate, timeScale]);

  const totalWidth = timeColumns.length * config.colWidth;
  const LEFT_COLUMN_WIDTH = 380; 
  const ROW_TOTAL_WIDTH = LEFT_COLUMN_WIDTH + totalWidth;

  const calculateMissionMargin = (m: Mission) => {
    let totalProdCost = 0;
    const missionId = m.id;
    const countryKey = m.country as string;
    const missionTimesheets = state.timesheets.filter(t => t.missionId === missionId && t.status === TimesheetStatus.VALIDE);

    // 1. INTERNES
    (m.internalStaffing || []).forEach(row => {
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;
      const userRef = state.users.find(u => u.id === row.userId);
      const cjm = row.cjm || userRef?.cjm || 500;

      const userReal = missionTimesheets.filter(t => t.userId === row.userId);
      if (userReal.length > 0) {
        totalProdCost += (userReal.reduce((acc, t) => acc + t.percentage, 0) / 100) * cjm;
      }
      try {
        const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
        weeks.forEach(wStart => {
          const weekKey = format(wStart, 'yyyy-MM-dd');
          if (!userReal.some(t => t.weekStart === weekKey)) {
            const wEnd = endOfWeek(wStart, { weekStartsOn: 1 });
            const overlapStart = wStart < start ? start : wStart;
            const overlapEnd = wEnd > end ? end : wEnd;
            if (overlapStart <= overlapEnd) {
              const bDays = getBusinessDays(overlapStart, overlapEnd, state.holidays, m.country);
              totalProdCost += bDays.length * (row.percentage / 100) * cjm;
            }
          }
        });
      } catch(e) {}
    });

    // 2. FREELANCES (SYNCHRO BUDGET)
    (m.freelanceStaffing || []).forEach(row => {
      const autoId = `auto-f-${row.id}-${missionId}`;
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;

      const monthsOfProject = eachMonthOfInterval({ start, end });
      monthsOfProject.forEach(mDate => {
        const monthId = mDate.getMonth();
        const fy = getFiscalYear(mDate);
        const manualExpense = state.manualExpenses[fy]?.[countryKey]?.find(e => e.id === autoId);
        const overrideAmount = manualExpense?.monthlyAmounts?.[monthId];

        if (overrideAmount !== undefined) {
          totalProdCost += Number(overrideAmount);
        } else {
          const userReal = missionTimesheets.filter(t => t.userId === row.id && format(startOfWeek(parseISO(t.weekStart), {weekStartsOn: 1}), 'MM') === format(mDate, 'MM'));
          if (userReal.length > 0) {
            totalProdCost += (userReal.reduce((acc, t) => acc + t.percentage, 0) / 100) * row.cjm;
          } else {
            const mStart = startOfMonth(mDate);
            const mEnd = endOfMonth(mDate);
            const overlapStart = mStart < start ? start : mStart;
            const overlapEnd = mEnd > end ? end : mEnd;
            if (overlapStart <= overlapEnd) {
              const bDays = getBusinessDays(overlapStart, overlapEnd, state.holidays, m.country);
              totalProdCost += bDays.length * (row.percentage / 100) * row.cjm;
            }
          }
        }
      });
    });

    // 3. SOUS-TRAITANTS (SYNCHRO BUDGET)
    (m.subcontractorStaffing || []).forEach(row => {
      const autoId = `auto-s-${row.id}-${missionId}`;
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;

      const monthsOfProject = eachMonthOfInterval({ start, end });
      let subcontractorCost = 0;
      monthsOfProject.forEach(mDate => {
        const monthId = mDate.getMonth();
        const fy = getFiscalYear(mDate);
        const manualExpense = state.manualExpenses[fy]?.[countryKey]?.find(e => e.id === autoId);
        const overrideAmount = manualExpense?.monthlyAmounts?.[monthId];

        if (overrideAmount !== undefined) {
          subcontractorCost += Number(overrideAmount);
        } else {
          const totalDays = Math.max(1, differenceInDays(end, start) + 1);
          const dailyRate = row.amount / totalDays;
          const mStart = startOfMonth(mDate);
          const mEnd = endOfMonth(mDate);
          const overlapStart = mStart < start ? start : mStart;
          const overlapEnd = mEnd > end ? end : mEnd;
          if (overlapStart <= overlapEnd) {
            const overlapDays = differenceInDays(overlapEnd, overlapStart) + 1;
            subcontractorCost += overlapDays * dailyRate;
          }
        }
      });
      totalProdCost += subcontractorCost;
    });

    const revenue = 
      (Number(m.forfaitAmountCurrentFY) || 0) + 
      (Number(m.forfaitAmountNextFY) || 0) + 
      (Number(m.successFeesCurrentFY) || 0) + 
      (Number(m.successFeesNextFY) || 0);

    const marginAmount = revenue - totalProdCost;
    return revenue > 0 ? (marginAmount / revenue) * 100 : 0;
  };

  const getPixelOffset = (targetDate: Date) => {
    if (isBefore(targetDate, startDate)) return 0;
    if (isAfter(targetDate, endDate)) return totalWidth;
    const periodStart = config.getStart(targetDate);
    let periodEnd: Date;
    if (timeScale === 'week') periodEnd = addWeeks(periodStart, 1);
    else if (timeScale === 'month') periodEnd = addMonths(periodStart, 1);
    else periodEnd = addQuarters(periodStart, 1);
    const periodIndex = config.getDiff(startDate, periodStart);
    const totalDaysInPeriod = Math.max(1, differenceInDays(periodEnd, periodStart));
    const daysOffsetInPeriod = differenceInDays(targetDate, periodStart);
    const subColOffset = (daysOffsetInPeriod / totalDaysInPeriod) * config.colWidth;
    return (periodIndex * config.colWidth) + subColOffset;
  };

  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollContainerRef.current) {
      const x = getPixelOffset(today);
      scrollContainerRef.current.scrollTo({
        left: x,
        behavior
      });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToToday('auto');
    }, 150);
    return () => clearTimeout(timer);
  }, [timeScale, startDateStr, endDateStr]);

  const getBarStyles = (startStr: string, endStr: string) => {
    const dStart = parseISO(startStr);
    const dEnd = parseISO(endStr);
    if (!isValid(dStart) || !isValid(dEnd)) return null;
    if (isAfter(dStart, endDate) || isBefore(dEnd, startDate)) return null;
    const pixelStart = getPixelOffset(dStart);
    const pixelEnd = getPixelOffset(addDays(dEnd, 1));
    const width = Math.max(10, pixelEnd - pixelStart);
    return { left: `${pixelStart}px`, width: `${width}px`, numericLeft: pixelStart, numericWidth: width };
  };

  const getConsultantBarStyles = (userId: string, m: Mission) => {
    const internal = m.internalStaffing?.find(s => s.userId === userId);
    const freelance = m.freelanceStaffing?.find(f => f.id === userId);
    const subcontractor = m.subcontractorStaffing?.find(s => s.id === userId);
    const staffing = internal || freelance || subcontractor;
    if (!staffing) return null;
    return getBarStyles(staffing.startDate, staffing.endDate);
  };

  useEffect(() => {
    if (!resizing) return;
    document.body.style.cursor = 'ew-resize';
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizing.initialMouseX;
      const pixelsPerDay = config.colWidth / config.daysInUnit;
      const deltaDays = Math.round(deltaX / pixelsPerDay);
      if (deltaDays === 0) return;
      const originalDate = parseISO(resizing.initialDate);
      if (!isValid(originalDate)) return;
      const newDate = addDays(originalDate, deltaDays);
      const newDateStr = format(newDate, 'yyyy-MM-dd');
      setResizing(prev => prev ? { ...prev, currentDate: newDateStr, mouseX: e.clientX, mouseY: e.clientY } : null);
      const newMissions = state.missions.map(m => {
        if (m.id !== resizing.id) return m;
        if (resizing.direction === 'left') {
          if (isAfter(newDate, parseISO(m.endDate))) return m;
          return { ...m, startDate: newDateStr };
        } else {
          if (isBefore(newDate, parseISO(m.startDate))) return m;
          return { ...m, endDate: newDateStr };
        }
      });
      updateState({ missions: newMissions });
    };
    const handleMouseUp = () => {
      if (resizing) {
        const modifiedMission = state.missions.find(m => m.id === resizing.id);
        if (modifiedMission) {
          syncMissionToCloud(modifiedMission);
        }
      }
      setResizing(null);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, config, state.missions, updateState]);

  const handleStartResize = (e: React.MouseEvent, missionId: string, direction: 'left' | 'right', initialDate: string) => {
    e.preventDefault(); e.stopPropagation();
    setResizing({ id: missionId, direction, initialMouseX: e.clientX, initialDate, currentDate: initialDate, mouseX: e.clientX, mouseY: e.clientY });
  };

  const filteredMissions = useMemo(() => {
    let result = state.missions.filter(m => 
      m.active && 
      (statusFilter === 'All' || 
       (statusFilter === 'Active' ? (m.status === MissionStatus.EN_COURS || m.status === MissionStatus.NON_DEMARREE) : m.status === statusFilter)) &&
      (state.globalCountry === 'Global' || m.country === state.globalCountry)
    );
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(m => m.clientName.toLowerCase().includes(term) || m.name.toLowerCase().includes(term));
    }
    return result.sort((a, b) => {
      let valA = a[sortConfig.key] as string;
      let valB = b[sortConfig.key] as string;
      if (sortConfig.key === 'startDate' || sortConfig.key === 'endDate') return parseISO(valA).getTime() - parseISO(valB).getTime();
      return valA.localeCompare(valB);
    });
  }, [state.missions, state.globalCountry, searchTerm, statusFilter, sortConfig]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  const getStickyOffset = (barLeft: number, barWidth: number) => {
    const offset = Math.max(0, scrollLeft - barLeft);
    return Math.min(offset, barWidth);
  };

  const getMissionWarnings = (m: Mission) => {
    const mStart = parseISO(m.startDate);
    const mEnd = parseISO(m.endDate);
    const allStaff = [...(m.internalStaffing || []), ...(m.freelanceStaffing || []), ...(m.subcontractorStaffing || [])].filter(s => s.startDate && s.endDate);
    if (allStaff.length === 0) return { any: true, message: "Alerte : Aucun staffing sur cette mission" };
    const earliestStaffStart = allStaff.reduce((min, s) => { const d = parseISO(s.startDate); return isBefore(d, min) ? d : min; }, parseISO(allStaff[0].startDate));
    const latestStaffEnd = allStaff.reduce((max, s) => { const d = parseISO(s.endDate); return isAfter(d, max) ? d : max; }, parseISO(allStaff[0].startDate));
    const hasGap = isBefore(mStart, earliestStaffStart) || isAfter(mEnd, latestStaffEnd);
    const hasOverflow = isBefore(earliestStaffStart, mStart) || isAfter(latestStaffEnd, mEnd);
    if (hasGap) return { any: true, message: "Alerte : Mission non couverte" };
    if (hasOverflow) return { any: true, message: "Alerte : Staffing hors période mission" };
    return { any: false };
  };

  const toggleMissionExpansion = (missionId: string) => {
    setExpandedMissions(prev => {
      const next = new Set(prev);
      if (next.has(missionId)) next.delete(missionId);
      else next.add(missionId);
      return next;
    });
  };

  const todayX = useMemo(() => getPixelOffset(today), [today, config, startDate]);
  const isTodayInView = todayX > 0 && todayX < totalWidth;

  return (
    <div className="space-y-6 flex flex-col h-full relative">
      {resizing && (
        <div 
          className="fixed z-[9999] pointer-events-none flex flex-col items-center gap-1 -translate-x-1/2 -translate-y-full pb-4 animate-in fade-in duration-150"
          style={{ left: resizing.mouseX, top: resizing.mouseY }}
        >
          <div className="bg-navy text-white px-3 py-1.5 rounded-lg shadow-2xl border border-white/20 flex items-center gap-2">
            <CalendarDays size={14} className="text-yellow-accent" />
            <span className="text-[11px] font-black tracking-tight font-mono">
              {format(parseISO(resizing.currentDate), 'dd/MM/yyyy')}
            </span>
          </div>
          <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-navy"></div>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border shadow-sm flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input type="text" placeholder="Rechercher client ou mission..." className="w-full pl-9 pr-4 py-2 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-yellow-accent" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>

          <div className="flex bg-gray-100 p-1 rounded-lg items-center gap-1">
            <Filter size={12} className="text-gray-400 mx-1" />
            <button 
              onClick={() => setStatusFilter('All')} 
              className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter ${statusFilter === 'All' ? 'bg-white shadow-sm text-navy' : 'text-gray-500 hover:text-navy'}`}
            >
              Toutes
            </button>
            <button 
              onClick={() => setStatusFilter('Active')} 
              className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter ${statusFilter === 'Active' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500 hover:text-navy'}`}
            >
              En cours + Non démarrée
            </button>
            <button 
              onClick={() => setStatusFilter(MissionStatus.EN_COURS)} 
              className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter ${statusFilter === MissionStatus.EN_COURS ? 'bg-white shadow-sm text-navy' : 'text-gray-500 hover:text-navy'}`}
            >
              En cours
            </button>
            <button 
              onClick={() => setStatusFilter(MissionStatus.NON_DEMARREE)} 
              className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter ${statusFilter === MissionStatus.NON_DEMARREE ? 'bg-white shadow-sm text-navy' : 'text-gray-500 hover:text-navy'}`}
            >
              Non démarrée
            </button>
            <button 
              onClick={() => setStatusFilter(MissionStatus.TERMINEE)} 
              className={`px-2 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-tighter ${statusFilter === MissionStatus.TERMINEE ? 'bg-white shadow-sm text-red-600' : 'text-gray-500 hover:text-navy'}`}
            >
              Terminées
            </button>
          </div>

          {(searchTerm || statusFilter !== 'Active') && (
            <button onClick={() => { setSearchTerm(''); setStatusFilter('Active'); }} className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-100 uppercase">
              <FilterX size={12} /> Reset
            </button>
          )}

          <button 
            onClick={() => scrollToToday('smooth')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-navy text-yellow-accent rounded-lg transition-all hover:bg-navy/90 shadow-sm uppercase tracking-tighter"
          >
            <CalendarClock size={12} />
            Aujourd'hui
          </button>

          <div className="flex bg-gray-100 p-1 rounded-lg">
            {(['week', 'month', 'quarter'] as TimeScale[]).map(s => (
              <button key={s} onClick={() => setTimeScale(s)} className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all ${timeScale === s ? 'bg-white shadow-sm text-navy' : 'text-gray-500 hover:text-navy'}`}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-navy/5 px-3 py-1 rounded-lg border border-navy/10 shrink-0">
          <CalendarRange size={14} className="text-navy/40" />
          <div className="flex items-center gap-1.5">
            <input 
              type="date" 
              className="bg-transparent text-[10px] font-black text-navy/70 uppercase outline-none focus:bg-white focus:ring-1 focus:ring-yellow-accent rounded px-1 transition-all w-28 cursor-pointer"
              value={startDateStr}
              onChange={(e) => setStartDateStr(e.target.value)}
              title="Date de début du planning"
            />
            <span className="text-[10px] font-black text-navy/30">—</span>
            <input 
              type="date" 
              className="bg-transparent text-[10px] font-black text-navy/70 uppercase outline-none focus:bg-white focus:ring-1 focus:ring-yellow-accent rounded px-1 transition-all w-28 cursor-pointer"
              value={endDateStr}
              onChange={(e) => setEndDateStr(e.target.value)}
              title="Date de fin du planning"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm flex flex-1 min-h-0 overflow-auto relative" ref={scrollContainerRef} onScroll={handleScroll}>
        <div className="flex flex-col min-w-full relative" style={{ width: `${ROW_TOTAL_WIDTH}px` }}>
          
          {isTodayInView && (
            <div 
              className="absolute top-0 bottom-0 w-[2.5px] bg-red-600/70 z-40 pointer-events-none transition-all duration-300 shadow-[0_0_10px_rgba(220,38,38,0.4)]"
              style={{ left: `${LEFT_COLUMN_WIDTH + todayX}px` }}
            >
              <div className="sticky top-0 z-[60] flex flex-col items-center -translate-x-1/2 pt-1.5">
                <div className="w-3.5 h-3.5 bg-red-600 rounded-full border-2 border-white shadow-lg"></div>
                <div className="text-[8px] font-black bg-red-600 text-white px-2 py-0.5 rounded shadow-sm mt-0.5 uppercase tracking-tighter ring-1 ring-white/20 whitespace-nowrap">AUJOURD'HUI</div>
              </div>
            </div>
          )}

          <div className="flex sticky top-0 z-50 bg-white" style={{ width: `${ROW_TOTAL_WIDTH}px` }}>
            <div className="shrink-0 h-14 bg-white border-b border-r px-4 flex items-center font-bold text-[10px] uppercase text-gray-400 sticky left-0 z-50 shadow-[6px_0_15px_-5px_rgba(0,0,0,0.25)]" style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}>
              Mission & Client
            </div>
            {timeColumns.map((col, i) => {
              const isCurrent = config.isCurrent(col);
              return (
                <div key={i} className={`h-14 flex flex-col items-center justify-center border-b border-r border-gray-200 text-[10px] font-bold shrink-0 ${isCurrent ? 'bg-yellow-50 text-navy' : 'bg-white text-gray-400'}`} style={{ width: config.colWidth }}>
                   <span className="uppercase">{config.getLabel(col)}</span>
                   <span className="text-[8px] opacity-60 mt-0.5 font-medium">{format(col, 'dd/MM')}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col relative">
            {filteredMissions.map((m, idx) => {
              const isEven = idx % 2 === 0;
              const isExpanded = expandedMissions.has(m.id);
              const isMissionHovered = hoveredRowId === m.id;
              const barStyles = getBarStyles(m.startDate, m.endDate);
              const margin = calculateMissionMargin(m);
              const staff = state.planning.filter(p => p.missionId === m.id);
              const uniqueStaff = Array.from(new Set(staff.map(s => s.userId))).map((id: string) => {
                const pEntry = staff.find(s => s.userId === id);
                const user = state.users.find(u => u.id === id);
                return { id, name: pEntry?.externalName || (user ? `${user.firstName} ${user.lastName}` : 'Inconnu'), type: pEntry?.externalType };
              });
              
              const missionWarnings = getMissionWarnings(m);
              const rowBgColor = isEven ? 'bg-white' : 'bg-slate-50';
              const missionWeatherId = staff.find(p => p.weather)?.weather || 'sun';
              const WeatherConfig = WEATHER_ICONS[missionWeatherId];
              const WeatherIcon = WeatherConfig?.icon || Sun;
              const marginColor = margin >= 30 ? 'text-green-600 border-green-200 bg-green-50' : margin >= 15 ? 'text-amber-500 border-amber-200 bg-amber-50' : 'text-red-600 border-red-200 bg-red-50';

              return (
                <React.Fragment key={m.id}>
                  <div 
                    className={`flex h-14 border-b border-gray-100 group transition-colors flex-nowrap`} 
                    style={{ width: `${ROW_TOTAL_WIDTH}px` }}
                    onMouseEnter={() => setHoveredRowId(m.id)} 
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    <div 
                      onClick={() => toggleMissionExpansion(m.id)} 
                      className={`px-4 flex items-center cursor-pointer border-l-4 border-r sticky left-0 z-40 shrink-0 transition-all opacity-100 shadow-[6px_0_15px_-8px_rgba(0,0,0,0.3)] ${isMissionHovered ? 'border-l-yellow-accent bg-slate-200' : 'border-l-transparent ' + rowBgColor}`}
                      style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}
                    >
                      <div className="mr-3 text-navy/30 shrink-0">{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
                      <div className="mr-3 shrink-0">
                         <WeatherIcon size={16} className={`${WeatherConfig?.color} drop-shadow-sm`} />
                      </div>
                      <div className="overflow-hidden flex-1 mr-3">
                        <div className="font-black text-navy text-[11px] uppercase truncate leading-tight tracking-tight">{m.clientName}</div>
                        <div className="text-[9px] text-gray-400 font-medium truncate mt-0.5">{m.name}</div>
                      </div>
                      <div className={`w-9 h-9 rounded-lg flex flex-col items-center justify-center border shrink-0 shadow-sm ${marginColor}`}>
                        <span className="text-[9px] font-black leading-none">{Math.round(margin)}%</span>
                        <span className="text-[6px] font-bold uppercase mt-0.5 opacity-60">MG</span>
                      </div>
                    </div>
                    <div className="flex-1 relative h-full">
                      {barStyles && (
                        <div className={`absolute top-1/2 -translate-y-1/2 h-10 rounded-lg flex items-center px-4 shadow-md border font-black text-[10px] uppercase tracking-wider transition-all z-10 overflow-hidden ${m.billingMode === BillingMode.FORFAIT ? 'bg-navy text-white border-navy/20' : 'bg-yellow-accent text-navy border-yellow-500/30'} ${m.status === MissionStatus.TERMINEE ? 'opacity-50 grayscale-[0.5]' : ''}`} style={{ left: barStyles.left, width: barStyles.width }}>
                          <div onMouseDown={(e) => handleStartResize(e, m.id, 'left', m.startDate)} className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/20 transition-colors rounded-l-lg z-20 flex items-center justify-center group/h">
                             <div className="w-1 h-4 bg-white/20 rounded-full group-hover/h:bg-white/40" />
                          </div>
                          <div 
                            style={{ transform: `translateX(${getStickyOffset(barStyles.numericLeft, barStyles.numericWidth)}px)` }}
                            className="flex items-center min-w-0 max-w-full gap-1.5 will-change-transform whitespace-nowrap"
                          >
                            <span className="font-black shrink-0">{m.clientName}</span>
                            <span className="opacity-40 font-normal mx-0.5">•</span>
                            <span className="font-medium text-[9px] opacity-90">{m.name}</span>
                            {m.status === MissionStatus.TERMINEE && <span className="ml-2 bg-gray-600/50 text-white px-1.5 py-0.5 rounded text-[7px] font-black uppercase">Terminé</span>}
                            {missionWarnings.any && m.status === MissionStatus.EN_COURS && (
                              <div className="bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0 ml-1.5 shadow-sm border border-white/20 animate-pulse">
                                <span className="text-[10px] font-black">!</span>
                              </div>
                            )}
                          </div>
                          <div onMouseDown={(e) => handleStartResize(e, m.id, 'right', m.endDate)} className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/20 transition-colors rounded-r-lg z-20 flex items-center justify-center group/h">
                             <div className="w-1 h-4 bg-white/20 rounded-full group-hover/h:bg-white/40" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && uniqueStaff.map(s => {
                    const rowKey = `${m.id}-${s.id}`;
                    const isStaffHovered = hoveredRowId === rowKey;
                    const cBarStyles = getConsultantBarStyles(s.id, m);
                    const subRowBgColor = isEven ? 'bg-white' : 'bg-slate-50';
                    const staffEntries = staff.filter(p => p.userId === s.id);
                    const staffOccupancy = (() => {
                      const internal = m.internalStaffing?.find(st => st.userId === s.id);
                      const freelance = m.freelanceStaffing?.find(f => f.id === s.id);
                      const sub = m.subcontractorStaffing?.find(sub => sub.id === s.id);
                      return internal?.percentage || freelance?.percentage || sub?.percentage || 0;
                    })();
                    const staffSentiment = staffEntries.find(p => p.sentiment)?.sentiment || '😐';

                    return (
                      <div 
                        key={s.id} 
                        className={`flex h-14 border-b border-gray-100/50 transition-colors flex-nowrap`}
                        style={{ width: `${ROW_TOTAL_WIDTH}px` }}
                        onMouseEnter={() => setHoveredRowId(rowKey)} 
                        onMouseLeave={() => setHoveredRowId(null)}
                      >
                        <div 
                          className={`pl-12 pr-4 flex items-center gap-3 text-[10px] border-r sticky left-0 z-40 shrink-0 transition-all opacity-100 shadow-[6px_0_15px_-8px_rgba(0,0,0,0.3)] ${isStaffHovered ? 'border-l-yellow-accent bg-slate-200' : 'border-l-transparent ' + subRowBgColor}`}
                          style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.type === 'freelance' ? 'bg-orange-400' : s.type === 'subcontractor' ? 'bg-purple-400' : 'bg-blue-400'}`}></span>
                          <span className="font-bold text-navy/70 truncate flex-1 uppercase tracking-tight bg-transparent">{s.name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs drop-shadow-sm" title="Humeur">{staffSentiment}</span>
                            <span className="text-[9px] font-black bg-navy/10 text-navy px-1.5 py-0.5 rounded shadow-sm border border-navy/5">
                              {staffOccupancy}%
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 relative h-full">
                          {cBarStyles && (
                            <div className={`absolute top-1/2 -translate-y-1/2 h-10 rounded-lg border flex items-center justify-start gap-2 px-3 z-10 transition-transform shadow-sm overflow-hidden ${m.status === MissionStatus.TERMINEE ? 'opacity-40' : ''} ${s.type === 'freelance' ? 'bg-orange-50 border-orange-200 text-orange-800' : s.type === 'subcontractor' ? 'bg-purple-50 border-purple-200 text-purple-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`} style={{ left: cBarStyles.left, width: cBarStyles.width }}>
                              <div style={{ transform: `translateX(${getStickyOffset(cBarStyles.numericLeft, cBarStyles.numericWidth)}px)` }} className="flex-1 min-w-0 flex items-center justify-start gap-2 whitespace-nowrap animate-in fade-in duration-300 will-change-transform">
                                  <span className="text-[10px] font-bold">{s.name}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 px-4 py-2 bg-gray-50 border rounded-lg shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-400 rounded-full"></div>
          <span className="text-[9px] font-black text-navy/50 uppercase tracking-tighter">Jour FÉRIÉ</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-600 rounded-full flex items-center justify-center text-white text-[6px] font-black">!</div>
          <span className="text-[9px] font-black text-navy/50 uppercase tracking-tighter">Alertes Staffing</span>
        </div>
        <div className="h-4 w-px bg-gray-300 mx-1 shrink-0"></div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-navy rounded shadow-sm"></div>
          <span className="text-[9px] font-black text-navy/50 uppercase tracking-tighter">Mode Forfait</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-yellow-accent rounded shadow-sm"></div>
          <span className="text-[9px] font-black text-navy/50 uppercase tracking-tighter">Mode Régie</span>
        </div>
      </div>
    </div>
  );
};

export default Planning;