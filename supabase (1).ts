import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Edit2, Trash2, X, Save, AlertTriangle, Search, ArrowUpDown, 
  ChevronUp, ChevronDown, Users, Calendar, Percent, UserPlus, 
  Briefcase, Building2, Wallet, HardHat, Globe, Tag,
  Euro,
  TrendingUp,
  Receipt,
  Filter,
  FilterX,
  Coins,
  Calculator,
  HandCoins,
  ClipboardList,
  Target,
  User as UserIcon
} from 'lucide-react';
import { 
  AppState, Mission, Country, MissionStatus, BillingMode, 
  PlanningEntry, ExternalFreelance, ExternalSubcontractor, InternalStaffing, ManualExpense, TimesheetStatus 
} from '../types';
import { generateId, getBusinessDays, getMonday, getFiscalYear, calculateTotalMissionRevenue, calculateSmoothedMissionRevenue } from '../utils';
import { 
  syncMissionToCloud, 
  syncPlanningToCloud, 
  deleteMissionFromCloud, 
  deletePlanningEntriesForMission 
} from '../services/dataService';
import { MISSION_TYPES, TYPOLOGIES } from '../constants';
import { 
  eachWeekOfInterval, 
  format, 
  parseISO, 
  startOfWeek, 
  eachMonthOfInterval, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  isValid, 
  differenceInDays,
  endOfWeek,
  isSameDay,
  isWeekend
} from 'date-fns';

interface MissionsProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

type MissionSortKey = keyof Mission | 'dates' | 'margin' | 'managerName' | 'prodCost' | 'marginAmount';

const TYPOLOGY_COLORS: Record<string, string> = {
  'SUPPLY CHAIN': 'bg-blue-100 text-blue-700 border-blue-200',
  'Stratégie': 'bg-purple-100 text-purple-700 border-purple-200',
  'Opérations': 'bg-green-100 text-green-700 border-green-200',
  'Achats': 'bg-orange-100 text-orange-700 border-orange-200',
  'IT': 'bg-red-100 text-red-700 border-red-200',
  'Finance': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  'HR': 'bg-pink-100 text-pink-700 border-pink-200',
  'PMO': 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

const COUNTRY_FLAGS: Record<string, string> = {
  [Country.FRANCE]: '🇫🇷',
  [Country.SPAIN]: '🇪🇸',
  [Country.ITALY]: '🇮🇹',
};

const Missions: React.FC<MissionsProps> = ({ state, updateState }) => {
  const [editingMission, setEditingMission] = useState<Partial<Mission> | null>(null);
  const [internalStaffing, setInternalStaffing] = useState<InternalStaffing[]>([]);
  const [freelanceStaffing, setFreelanceStaffing] = useState<ExternalFreelance[]>([]);
  const [subcontractorStaffing, setSubcontractorStaffing] = useState<ExternalSubcontractor[]>([]);
  
  const [missionToDelete, setMissionToDelete] = useState<string | null>(null);
  const [missionSearch, setMissionSearch] = useState('');
  
  const actualFYStr = useMemo(() => getFiscalYear(new Date()), []);
  const actualYear = parseInt(actualFYStr.replace('FY', ''));
  
  const labelFYN = `€ CA FY ${actualYear} (en cours)`;
  const labelFYN1 = `€ CA FY ${actualYear + 1} (à venir)`;
  const labelSFYN = `Success Fees FY ${actualYear}`;
  const labelSFYN1 = `Success Fees FY ${actualYear + 1}`;

  const [typologyFilter, setTypologyFilter] = useState<string>('All');
  const [billingModeFilter, setBillingModeFilter] = useState<string>('All');
  const [managerFilter, setManagerFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('Active');

  const [missionSortConfig, setMissionSortConfig] = useState<{ key: MissionSortKey; direction: 'asc' | 'desc' }>({ 
    key: 'clientName', 
    direction: 'asc' 
  });

  useEffect(() => {
    if (editingMission && editingMission.id) {
      if (editingMission.internalStaffing && editingMission.internalStaffing.length > 0) {
        setInternalStaffing([...editingMission.internalStaffing]);
      } else {
        const existingPlanning = state.planning.filter(p => p.missionId === editingMission.id && !p.externalType);
        const groupedInternals: Record<string, PlanningEntry[]> = {};
        existingPlanning.forEach(p => {
          if (!groupedInternals[p.userId]) groupedInternals[p.userId] = [];
          groupedInternals[p.userId].push(p);
        });

        const intRows: InternalStaffing[] = Object.entries(groupedInternals).map(([userId, entries]) => {
          const dates = entries.map(e => parseISO(e.weekStart));
          const user = state.users.find(u => u.id === userId);
          return {
            id: generateId(),
            userId,
            startDate: format(new Date(Math.min(...dates.map(d => d.getTime()))), 'yyyy-MM-dd'),
            endDate: format(new Date(Math.max(...dates.map(d => d.getTime()))), 'yyyy-MM-dd'),
            percentage: Math.round(entries.reduce((acc, e) => acc + e.percentage, 0) / entries.length),
            cjm: entries[0].costDay || user?.cjm || 500,
            tjm: entries[0].tjm || 800
          };
        });
        setInternalStaffing(intRows);
      }
      setFreelanceStaffing(editingMission.freelanceStaffing || []);
      setSubcontractorStaffing(editingMission.subcontractorStaffing || []);
    } else {
      setInternalStaffing([]);
      setFreelanceStaffing([]);
      setSubcontractorStaffing([]);
    }
  }, [editingMission?.id]);

  /**
   * Calcule les métriques de mission.
   */
  const calculateMissionMetrics = (mission: Partial<Mission>, internals: InternalStaffing[], freelances: ExternalFreelance[], subs: ExternalSubcontractor[], forceForecast: boolean = false) => {
    let totalProdCost = 0;
    const missionId = mission.id;
    if (!missionId) return { prodCost: 0, marginAmount: 0, marginPercent: 0, revenue: 0 };
    
    const countryKey = mission.country as string;
    const missionTimesheets = state.timesheets.filter(t => t.missionId === missionId && t.status === TimesheetStatus.VALIDE);

    // 1. COÛTS INTERNES
    internals.forEach(row => {
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;
      
      const userRef = state.users.find(u => u.id === row.userId);
      const cjm = row.cjm || userRef?.cjm || 500;

      if (!forceForecast) {
        // Logique "Réelle + Prév" : On somme les timesheets validées
        const userReal = missionTimesheets.filter(t => t.userId === row.userId);
        if (userReal.length > 0) {
          totalProdCost += (userReal.reduce((acc, t) => acc + t.percentage, 0) / 100) * cjm;
        }
        // Et on ajoute le prévisionnel pour les semaines qui n'ont pas encore de saisie validée
        try {
          const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
          weeks.forEach(wStart => {
            const weekKey = format(wStart, 'yyyy-MM-dd');
            if (!userReal.some(t => t.weekStart === weekKey)) {
              const wEnd = endOfWeek(wStart, { weekStartsOn: 1 });
              const overlapStart = wStart < start ? start : wStart;
              const overlapEnd = wEnd > end ? end : wEnd;
              if (overlapStart <= overlapEnd) {
                const bDays = getBusinessDays(overlapStart, overlapEnd, state.holidays, mission.country!);
                totalProdCost += bDays.length * (row.percentage / 100) * cjm;
              }
            }
          });
        } catch(e) {}
      } else {
        // Logique "Prévisionnelle" pure
        const bDays = getBusinessDays(start, end, state.holidays, mission.country!);
        totalProdCost += bDays.length * (row.percentage / 100) * cjm;
      }
    });

    // 2. COÛTS FREELANCES
    freelances.forEach(row => {
      const autoId = `auto-f-${row.id}-${missionId}`;
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;

      const monthsOfProject = eachMonthOfInterval({ start, end });
      monthsOfProject.forEach(mDate => {
        const monthId = mDate.getMonth();
        const fy = getFiscalYear(mDate);
        
        // On récupère l'override budgétaire (onglet Suivi Dépenses)
        const manualExpense = state.manualExpenses[fy]?.[countryKey]?.find(e => e.id === autoId);
        const overrideAmount = manualExpense?.monthlyAmounts?.[monthId];

        if (!forceForecast && overrideAmount !== undefined) {
          totalProdCost += Number(overrideAmount);
        } else {
          // Calcul au prorata jours ouvrés
          const mStart = startOfMonth(mDate);
          const mEnd = endOfMonth(mDate);
          const overlapStart = mStart < start ? start : mStart;
          const overlapEnd = mEnd > end ? end : mEnd;
          if (overlapStart <= overlapEnd) {
            const bDays = getBusinessDays(overlapStart, overlapEnd, state.holidays, mission.country!);
            totalProdCost += bDays.length * (row.percentage / 100) * row.cjm;
          }
        }
      });
    });

    // 3. COÛTS SOUS-TRAITANTS
    subs.forEach(row => {
      const autoId = `auto-s-${row.id}-${missionId}`;
      const start = parseISO(row.startDate);
      const end = parseISO(row.endDate);
      if (!isValid(start) || !isValid(end)) return;

      const monthsOfProject = eachMonthOfInterval({ start, end });
      monthsOfProject.forEach(mDate => {
        const monthId = mDate.getMonth();
        const fy = getFiscalYear(mDate);
        const manualExpense = state.manualExpenses[fy]?.[countryKey]?.find(e => e.id === autoId);
        const overrideAmount = manualExpense?.monthlyAmounts?.[monthId];

        if (!forceForecast && overrideAmount !== undefined) {
          totalProdCost += Number(overrideAmount);
        } else {
          const totalDays = Math.max(1, differenceInDays(end, start) + 1);
          const dailyRate = row.amount / totalDays;
          const mStart = startOfMonth(mDate);
          const mEnd = endOfMonth(mDate);
          const overlapStart = mStart < start ? start : mStart;
          const overlapEnd = mEnd > end ? end : mEnd;
          if (overlapStart <= overlapEnd) {
            const overlapDays = differenceInDays(overlapEnd, overlapStart) + 1;
            totalProdCost += overlapDays * dailyRate;
          }
        }
      });
    });

    const revenue = calculateTotalMissionRevenue(mission as Mission);

    const marginAmount = revenue - totalProdCost;
    const marginPercent = revenue > 0 ? (marginAmount / revenue) * 100 : 0;

    return { prodCost: Math.round(totalProdCost), marginAmount: Math.round(marginAmount), marginPercent, revenue };
  };

  const currentMetrics = useMemo(() => {
    if (!editingMission) return { prodCost: 0, marginAmount: 0, marginPercent: 0, revenue: 0 };
    return calculateMissionMetrics(editingMission, internalStaffing, freelanceStaffing, subcontractorStaffing, false);
  }, [editingMission, internalStaffing, freelanceStaffing, subcontractorStaffing, state.holidays, state.timesheets, state.manualExpenses]);

  const forecastMetrics = useMemo(() => {
    if (!editingMission) return { prodCost: 0, marginAmount: 0, marginPercent: 0, revenue: 0 };
    return calculateMissionMetrics(editingMission, internalStaffing, freelanceStaffing, subcontractorStaffing, true);
  }, [editingMission, internalStaffing, freelanceStaffing, subcontractorStaffing, state.holidays]);

  const handleSaveMission = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMission) return;

    const missionId = editingMission.id || generateId();
    const finalMission: Mission = {
      ...editingMission,
      id: missionId,
      clientId: editingMission.clientId || generateId(),
      active: true,
      internalStaffing,
      freelanceStaffing,
      subcontractorStaffing
    } as Mission;

    const updatedMissions = editingMission.id 
      ? state.missions.map(m => m.id === editingMission.id ? finalMission : m)
      : [...state.missions, finalMission];

    // Mise à jour de la planification globale pour refléter les TJMs et CJMs
    const otherPlanning = state.planning.filter(p => p.missionId !== missionId);
    const newMissionPlanning: PlanningEntry[] = [];
    const oldPlanningForMission = state.planning.filter(p => p.missionId === missionId);

    const generateEntries = (userId: string, startStr: string, endStr: string, pct: number, cost: number, tjm: number, extName?: string, extType?: any) => {
      try {
        const weeks = eachWeekOfInterval({ start: startOfWeek(parseISO(startStr), { weekStartsOn: 1 }), end: parseISO(endStr) }, { weekStartsOn: 1 });
        weeks.forEach(w => {
          const wKey = format(w, 'yyyy-MM-dd');
          const existing = oldPlanningForMission.find(p => p.userId === userId && p.weekStart === wKey);
          newMissionPlanning.push({ 
            id: existing?.id || generateId(), 
            missionId, userId, weekStart: wKey, 
            percentage: pct, tjm: tjm, costDay: cost,
            externalName: extName, externalType: extType,
            sentiment: existing?.sentiment, weather: existing?.weather, comment: existing?.comment
          });
        });
      } catch (err) {}
    };

    internalStaffing.forEach(s => generateEntries(s.userId, s.startDate, s.endDate, s.percentage, s.cjm, s.tjm));
    freelanceStaffing.forEach(f => generateEntries(f.id, f.startDate, f.endDate, f.percentage, f.cjm, f.tjm, `${f.firstName} ${f.lastName}`, 'freelance'));
    subcontractorStaffing.forEach(s => {
      const costPerDay = s.amount / 20;
      const tjmPerDay = s.soldAmount / 20;
      generateEntries(s.id, s.startDate, s.endDate, s.percentage, costPerDay, tjmPerDay, s.entity, 'subcontractor');
    });

    updateState({ 
      missions: updatedMissions,
      planning: [...otherPlanning, ...newMissionPlanning]
    });

    // Robust Cloud Sync
    syncMissionToCloud(finalMission);
    syncPlanningToCloud(newMissionPlanning);

    setEditingMission(null);
  };

  const confirmDeleteMission = () => {
    if (missionToDelete) {
      updateState({ 
        missions: state.missions.filter(m => m.id !== missionToDelete),
        planning: state.planning.filter(p => p.missionId !== missionToDelete)
      });
      
      // Robust Cloud Sync
      deleteMissionFromCloud(missionToDelete);
      deletePlanningEntriesForMission(missionToDelete);
      
      setMissionToDelete(null);
    }
  };

  const getManagerName = (managerId: string) => {
    const manager = state.users.find(u => u.id === managerId);
    return manager ? `${manager.firstName} ${manager.lastName}` : 'Inconnu';
  };

  const processedMissions = useMemo(() => {
    let result = [...state.missions];
    if (state.globalCountry !== 'Global') result = result.filter(m => m.country === state.globalCountry);
    if (missionSearch) {
      const term = missionSearch.toLowerCase();
      result = result.filter(m => m.clientName.toLowerCase().includes(term) || m.name.toLowerCase().includes(term));
    }
    if (typologyFilter !== 'All') result = result.filter(m => m.typology === typologyFilter);
    if (billingModeFilter !== 'All') result = result.filter(m => m.billingMode === billingModeFilter);
    if (managerFilter !== 'All') result = result.filter(m => m.managerId === managerFilter);
    if (statusFilter !== 'All') {
      if (statusFilter === 'Active') {
        result = result.filter(m => m.status === MissionStatus.EN_COURS || m.status === MissionStatus.NON_DEMARREE);
      } else {
        result = result.filter(m => m.status === statusFilter);
      }
    }

    return result.sort((a, b) => {
      let valA: any, valB: any;
      if (missionSortConfig.key === 'dates') {
        valA = parseISO(a.startDate).getTime(); valB = parseISO(b.startDate).getTime();
      } else if (missionSortConfig.key === 'margin') {
        valA = calculateMissionMetrics(a, a.internalStaffing || [], a.freelanceStaffing || [], a.subcontractorStaffing || []).marginPercent;
        valB = calculateMissionMetrics(b, b.internalStaffing || [], b.freelanceStaffing || [], b.subcontractorStaffing || []).marginPercent;
      } else if (missionSortConfig.key === 'prodCost') {
        valA = calculateMissionMetrics(a, a.internalStaffing || [], a.freelanceStaffing || [], a.subcontractorStaffing || []).prodCost;
        valB = calculateMissionMetrics(b, b.internalStaffing || [], b.freelanceStaffing || [], b.subcontractorStaffing || []).prodCost;
      } else if (missionSortConfig.key === 'marginAmount') {
        valA = calculateMissionMetrics(a, a.internalStaffing || [], a.freelanceStaffing || [], a.subcontractorStaffing || []).marginAmount;
        valB = calculateMissionMetrics(b, b.internalStaffing || [], b.freelanceStaffing || [], b.subcontractorStaffing || []).marginAmount;
      } else if (missionSortConfig.key === 'forfaitAmountCurrentFY') {
        valA = calculateTotalMissionRevenue(a);
        valB = calculateTotalMissionRevenue(b);
      } else if (missionSortConfig.key === 'managerName') {
        valA = getManagerName(a.managerId); valB = getManagerName(b.managerId);
      } else {
        valA = a[missionSortConfig.key as keyof Mission]; valB = b[missionSortConfig.key as keyof Mission];
      }
      const direction = missionSortConfig.direction === 'asc' ? 1 : -1;
      return typeof valA === 'string' ? direction * valA.localeCompare(valB || '') : direction * ((valA || 0) - (valB || 0));
    });
  }, [state.missions, missionSearch, missionSortConfig, state.globalCountry, typologyFilter, billingModeFilter, managerFilter, statusFilter, state.timesheets, state.holidays, state.manualExpenses]);

  const totalCAMission = useMemo(() => processedMissions.reduce((acc, m) => acc + calculateTotalMissionRevenue(m), 0), [processedMissions]);
  const totalCAFYN = useMemo(() => processedMissions.reduce((acc, m) => acc + calculateSmoothedMissionRevenue(m, actualFYStr), 0), [processedMissions, actualFYStr]);
  const totalCAFYN1 = useMemo(() => {
    const nextFY = `FY${actualYear + 1}`;
    return processedMissions.reduce((acc, m) => acc + calculateSmoothedMissionRevenue(m, nextFY), 0);
  }, [processedMissions, actualYear]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.round(val)) + ' €';
  const toggleSort = (key: MissionSortKey) => setMissionSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));

  const handleRemoveStaffingRow = (e: React.MouseEvent, type: 'internal' | 'freelance' | 'subcontractor', id: string) => {
    e.preventDefault(); e.stopPropagation();
    if (type === 'internal') setInternalStaffing(prev => prev.filter(item => item.id !== id));
    if (type === 'freelance') setFreelanceStaffing(prev => prev.filter(item => item.id !== id));
    if (type === 'subcontractor') setSubcontractorStaffing(prev => prev.filter(item => item.id !== id));
  };

  const isMissionFinished = editingMission?.status === MissionStatus.TERMINEE;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
        <div className="sticky top-0 z-30 bg-white border-b shadow-sm">
          <div className="p-4 bg-gray-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-navy uppercase text-xs tracking-wider">Missions</h2>
                <span className="bg-navy/10 text-navy px-2 py-0.5 rounded-full text-[10px] font-bold">{processedMissions.length}</span>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input type="text" placeholder="Rechercher..." className="pl-9 pr-4 py-1.5 text-xs border rounded-lg outline-none w-48 bg-white focus:ring-2 focus:ring-yellow-accent" value={missionSearch} onChange={e => setMissionSearch(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <select className="text-[10px] font-bold border rounded-lg px-2 py-1 outline-none bg-white text-navy uppercase tracking-tighter" value={typologyFilter} onChange={e => setTypologyFilter(e.target.value)}>
                  <option value="All">Toutes Typologies</option>
                  {TYPOLOGIES.map(t => <option value={t} key={t}>{t}</option>)}
                </select>
                <select className="text-[10px] font-bold border rounded-lg px-2 py-1 outline-none bg-white text-navy uppercase tracking-tighter" value={billingModeFilter} onChange={e => setBillingModeFilter(e.target.value)}>
                  <option value="All">Tous Modes</option>
                  {Object.values(BillingMode).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="text-[10px] font-bold border rounded-lg px-2 py-1 outline-none bg-white text-navy uppercase tracking-tighter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="All">Tous Statuts</option>
                  <option value="Active">En cours + Non démarrée</option>
                  {Object.values(MissionStatus).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="text-[10px] font-bold border rounded-lg px-2 py-1 outline-none bg-white text-navy uppercase tracking-tighter" value={managerFilter} onChange={e => setManagerFilter(e.target.value)}>
                  <option value="All">Tous Responsables</option>
                  {state.users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-8">
              <div className="hidden md:flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Total CA Missions</span>
                  <span className="text-sm font-black text-navy leading-none">{formatCurrency(totalCAMission)}</span>
                </div>
                <div className="w-px h-8 bg-gray-200"></div>
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">CA FY {actualYear}</span>
                  <span className="text-xs font-black text-navy/60 text-right leading-none">{formatCurrency(totalCAFYN)}</span>
                </div>
                <div className="w-px h-8 bg-gray-200"></div>
                <div className="flex flex-col items-end">
                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">CA FY {actualYear + 1}</span>
                  <span className="text-xs font-black text-navy/60 text-right leading-none">{formatCurrency(totalCAFYN1)}</span>
                </div>
              </div>
              
              <button onClick={() => setEditingMission({ name: '', clientName: '', billingMode: BillingMode.FORFAIT, status: MissionStatus.EN_COURS, startDate: format(new Date(), 'yyyy-MM-dd'), endDate: format(new Date(), 'yyyy-MM-dd'), country: Country.FRANCE, type: MISSION_TYPES[0], typology: TYPOLOGIES[0], managerId: state.users[0].id, forfaitAmountCurrentFY: 0, forfaitAmountNextFY: 0, successFeesCurrentFY: 0, successFeesNextFY: 0 })} className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-navy/90 transition-all shadow-md active:scale-95 shrink-0"><Plus size={16} /> Nouvelle Mission</button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto relative scrollbar-hide">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 font-bold select-none bg-white border-b">
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('clientName')}>Client / Mission <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('margin')}>Marge % <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('country')}>Pays <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4">Typologie</th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('managerName')}>Responsable <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4">Mode</th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('forfaitAmountCurrentFY')}>Total CA Mission <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('prodCost')}>Coût Prod. <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('marginAmount')}>Bénéfice <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b" onClick={() => toggleSort('dates')}>Date de mission <ArrowUpDown size={12} className="inline ml-1 opacity-20" /></th>
                <th className="p-4">Statut</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {processedMissions.map(m => {
                 const { marginPercent, prodCost, marginAmount } = calculateMissionMetrics(m, m.internalStaffing || [], m.freelanceStaffing || [], m.subcontractorStaffing || [], false);
                 return (
                  <tr key={m.id} onClick={() => setEditingMission(m)} className="text-sm hover:bg-gray-50 transition-colors border-b last:border-0 group cursor-pointer">
                    <td className="p-4 border-b group-last:border-0">
                      <div className="font-bold text-navy uppercase text-[11px] leading-tight">{m.clientName}</div>
                      <div className="text-[10px] text-gray-500 truncate max-w-[180px] mt-0.5">{m.name}</div>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <div className={`text-[12px] font-black ${marginPercent >= 30 ? 'text-green-600' : marginPercent >= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {Math.round(marginPercent)}%
                      </div>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{COUNTRY_FLAGS[m.country]}</span>
                        <span className="text-[10px] font-bold text-gray-600 uppercase">{m.country}</span>
                      </div>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${TYPOLOGY_COLORS[m.typology] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{m.typology}</span>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <div className="flex items-center gap-2">
                        <UserIcon size={12} className="text-gray-400" />
                        <span className="text-[10px] font-bold text-navy uppercase truncate max-w-[100px]">{getManagerName(m.managerId)}</span>
                      </div>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${m.billingMode === BillingMode.FORFAIT ? 'bg-navy/5 text-navy border-navy/10' : 'bg-yellow-accent/10 text-yellow-800 border-yellow-accent/20'}`}>{m.billingMode}</span>
                    </td>
                    <td className="p-4 border-b group-last:border-0 font-black text-navy text-sm whitespace-nowrap">
                      {formatCurrency(calculateTotalMissionRevenue(m))}
                    </td>
                    <td className="p-4 border-b group-last:border-0 font-black text-navy text-sm whitespace-nowrap">
                        <div className="flex flex-col">
                          <span>{formatCurrency(prodCost)}</span>
                          <span className="text-[8px] text-gray-400 uppercase font-bold tracking-tight">Réel + Prév.</span>
                        </div>
                    </td>
                    <td className={`p-4 border-b group-last:border-0 font-black text-sm whitespace-nowrap ${marginAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(marginAmount)}
                    </td>
                    <td className="p-4 border-b group-last:border-0 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-navy">
                        <Calendar size={12} className="text-navy/40" />
                        <span className="text-[10px] font-bold">
                          {format(parseISO(m.startDate), 'dd/MM/yy')} - {format(parseISO(m.endDate), 'dd/MM/yy')}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 border-b group-last:border-0">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border shadow-sm ${
                        m.status === MissionStatus.EN_COURS ? 'bg-green-50 text-green-700 border-green-200' : 
                        m.status === MissionStatus.NON_DEMARREE ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-gray-100 text-gray-500 border-gray-200'
                      }`}>{m.status}</span>
                    </td>
                    <td className="p-4 text-right border-b group-last:border-0">
                        <button onClick={(e) => { e.stopPropagation(); setMissionToDelete(m.id); }} className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editingMission && (
        <div className="fixed inset-0 bg-navy/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[90vh] animate-in zoom-in duration-200 border border-gray-100">
            <div className="p-6 bg-navy text-white flex justify-between items-center shrink-0">
              <h3 className="text-xl font-black uppercase tracking-tight">{editingMission.id ? 'Editer la mission' : 'Nouvelle Mission'}</h3>
              <button onClick={() => setEditingMission(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
            </div>

            <form onSubmit={handleSaveMission} className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
              <section className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-inner">
                <div className="md:col-span-3 border-b border-gray-200 pb-2 mb-2 flex items-center justify-between">
                  <h4 className="font-black text-[10px] text-navy uppercase tracking-widest flex items-center gap-2"><Briefcase size={16} className="text-yellow-accent" /> Informations Générales</h4>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Nom Mission</label>
                  <input required className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.name} onChange={e => setEditingMission({...editingMission, name: e.target.value})} placeholder="Ex: Plan de Transfo 2026..." />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Client</label>
                  <input required className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.clientName} onChange={e => setEditingMission({...editingMission, clientName: e.target.value})} placeholder="Nom du client" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Typologie</label>
                  <select className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all cursor-pointer" value={editingMission.typology} onChange={e => setEditingMission({...editingMission, typology: e.target.value})}>{TYPOLOGIES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Responsable Mission</label>
                  <select 
                    required 
                    className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all cursor-pointer" 
                    value={editingMission.managerId} 
                    onChange={e => setEditingMission({...editingMission, managerId: e.target.value})}
                  >
                    <option value="">Sélectionner...</option>
                    {state.users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest flex items-center gap-1"><Receipt size={12} className="text-navy/40" /> Mode Factu.</label>
                  <select className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all cursor-pointer" value={editingMission.billingMode} onChange={e => setEditingMission({...editingMission, billingMode: e.target.value as BillingMode})}>{Object.values(BillingMode).map(mode => <option key={mode} value={mode}>{mode}</option>)}</select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Pays</label>
                  <select className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all cursor-pointer" value={editingMission.country} onChange={e => setEditingMission({...editingMission, country: e.target.value as Country})}>{Object.values(Country).map(c => <option key={c} value={c}>{c}</option>)}</select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Date Début</label>
                  <input type="date" className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.startDate} onChange={e => setEditingMission({...editingMission, startDate: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Date Fin</label>
                  <input type="date" className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.endDate} onChange={e => setEditingMission({...editingMission, endDate: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">Statut</label>
                  <select 
                    className="w-full border rounded-xl px-4 py-2.5 font-bold text-sm focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all cursor-pointer" 
                    value={editingMission.status} 
                    onChange={e => setEditingMission({...editingMission, status: e.target.value as MissionStatus})}
                  >
                    {Object.values(MissionStatus).map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="p-6 bg-yellow-50/20 rounded-2xl border border-yellow-200/50 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5"><TrendingUp size={120} /></div>
                <div className="border-b border-yellow-200/50 pb-3 mb-6 flex justify-between items-center relative z-10">
                  <h4 className="font-black text-[10px] text-navy uppercase tracking-widest flex items-center gap-2"><TrendingUp size={16} className="text-yellow-600" /> Pilotage Financier & Rentabilité</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10 mb-8">
                  <div className="col-span-2 grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest flex items-center gap-1.5"><Euro size={12} className="text-navy/40" /> {labelFYN}</label>
                      <div className="relative">
                        <input type="number" className="w-full border rounded-xl pl-4 pr-10 py-3 font-black text-sm text-navy focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.forfaitAmountCurrentFY} onChange={e => setEditingMission({...editingMission, forfaitAmountCurrentFY: parseInt(e.target.value) || 0})} />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold text-sm">€</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest flex items-center gap-1.5"><Euro size={12} className="text-navy/40" /> {labelFYN1}</label>
                      <div className="relative">
                        <input type="number" className="w-full border rounded-xl pl-4 pr-10 py-3 font-black text-sm text-navy focus:ring-2 focus:ring-yellow-accent outline-none bg-white shadow-sm transition-all" value={editingMission.forfaitAmountNextFY} onChange={e => setEditingMission({...editingMission, forfaitAmountNextFY: parseInt(e.target.value) || 0})} />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold text-sm">€</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest flex items-center gap-1.5"><HandCoins size={12} className="text-amber-500" /> {labelSFYN}</label>
                      <div className="relative">
                        <input type="number" className="w-full border border-amber-100 rounded-xl pl-4 pr-10 py-3 font-black text-sm text-amber-700 focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20 shadow-sm transition-all" value={editingMission.successFeesCurrentFY || 0} onChange={e => setEditingMission({...editingMission, successFeesCurrentFY: parseInt(e.target.value) || 0})} />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-200 font-bold text-sm">€</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest flex items-center gap-1.5"><HandCoins size={12} className="text-amber-500" /> {labelSFYN1}</label>
                      <div className="relative">
                        <input type="number" className="w-full border border-amber-100 rounded-xl pl-4 pr-10 py-3 font-black text-sm text-amber-700 focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/20 shadow-sm transition-all" value={editingMission.successFeesNextFY || 0} onChange={e => setEditingMission({...editingMission, successFeesNextFY: parseInt(e.target.value) || 0})} />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-200 font-bold text-sm">€</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-3 bg-white/60 px-4 py-2 rounded-xl border border-yellow-200/40 shadow-sm">
                          <ClipboardList size={14} className="text-yellow-500" />
                          <div className="flex flex-col overflow-hidden">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Prod. (Prévisionnel) :</span>
                            <span className="text-xs font-black text-navy truncate">{formatCurrency(forecastMetrics.prodCost)}</span>
                          </div>
                      </div>
                      <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border shadow-sm transition-all duration-300 ${forecastMetrics.marginPercent >= 30 ? 'bg-green-50 border-green-100 text-green-700' : 'bg-white/60 border-yellow-200/40 text-navy'}`}>
                          <Target size={14} className="opacity-60" />
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-60 leading-none mb-1">Rentabilité Prév. :</span>
                            <span className="text-xs font-black">{Math.round(forecastMetrics.marginPercent)}%</span>
                          </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-yellow-200 shadow-sm">
                          <Coins size={14} className="text-yellow-600" />
                          <div className="flex flex-col overflow-hidden">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Prod. (Réelle + Prev.) :</span>
                            <span className="text-xs font-black text-navy truncate">{formatCurrency(currentMetrics.prodCost)}</span>
                          </div>
                      </div>
                      <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border shadow-sm transition-all duration-300 ${currentMetrics.marginPercent >= 30 ? 'bg-green-100 border-green-200 text-green-700' : 'bg-white border-yellow-200 text-navy'}`}>
                          <Calculator size={14} />
                          <div className="flex flex-col">
                             <span className="text-[8px] font-black uppercase tracking-widest opacity-60 leading-none mb-1">Rentabilité Réelle+Prév :</span>
                            <span className="text-xs font-black">{Math.round(currentMetrics.marginPercent)}%</span>
                          </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Staffing Interne */}
              <section className="space-y-6">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h4 className="font-black text-[10px] text-navy uppercase tracking-widest flex items-center gap-2"><Users size={18} className="text-blue-500" /> Consultants Internes (Staffing Prév.)</h4>
                  <button type="button" onClick={() => setInternalStaffing([...internalStaffing, { id: generateId(), userId: '', startDate: editingMission.startDate!, endDate: editingMission.endDate!, percentage: 100, cjm: 500, tjm: 800 }])} className="text-[10px] font-black text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-100 bg-blue-50/30 px-4 py-2 rounded-xl flex items-center gap-2 uppercase transition-all shadow-sm active:scale-95"><UserPlus size={16} /> Ajouter Interne</button>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-6 snap-x no-scrollbar">
                  {internalStaffing.map((row) => (
                    <div key={row.id} className="w-[300px] shrink-0 p-5 border border-gray-100 rounded-2xl bg-white shadow-lg hover:shadow-xl transition-all relative group snap-start animate-in zoom-in duration-300">
                      <button type="button" onClick={(e) => handleRemoveStaffingRow(e, 'internal', row.id)} className="absolute top-3 right-3 p-1.5 bg-red-50 text-red-500 hover:bg-red-600 hover:text-white rounded-full transition-all z-20 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                      <div className="space-y-5">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Consultant</label>
                          <select className="w-full border-b-2 py-2 text-sm font-black text-navy outline-none focus:border-blue-500 transition-colors bg-transparent cursor-pointer" value={row.userId} onChange={e => {
                            const next = [...internalStaffing];
                            const idx = next.findIndex(item => item.id === row.id);
                            const user = state.users.find(u => u.id === e.target.value);
                            if (idx !== -1) {
                              next[idx].userId = e.target.value;
                              if (user) next[idx].cjm = user.cjm; 
                              setInternalStaffing(next);
                            }
                          }}>
                            <option value="">Sélectionner...</option>
                            {state.users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">Début</label>
                            <input type="date" className="w-full text-xs font-bold border-b py-1 outline-none focus:border-navy" value={row.startDate} onChange={e => {
                              const next = [...internalStaffing];
                              const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].startDate = e.target.value; setInternalStaffing(next); }
                            }} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">Fin</label>
                            <input type="date" className="w-full text-xs font-bold border-b py-1 outline-none focus:border-navy" value={row.endDate} onChange={e => {
                              const next = [...internalStaffing];
                              const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].endDate = e.target.value; setInternalStaffing(next); }
                            }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 hidden">
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">CJM (€)</label>
                            <input 
                              type="number" 
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-black text-navy outline-none ${isMissionFinished ? 'bg-gray-100 cursor-not-allowed opacity-70' : 'bg-white focus:ring-1 focus:ring-yellow-accent'}`}
                              value={row.cjm} 
                              disabled={isMissionFinished}
                              title={isMissionFinished ? "Le CJM est figé car la mission est terminée" : "Modifiez manuellement le CJM si nécessaire"}
                              onChange={e => {
                               const next = [...internalStaffing];
                               const idx = next.findIndex(item => item.id === row.id);
                               if (idx !== -1) { next[idx].cjm = parseInt(e.target.value) || 0; setInternalStaffing(next); }
                            }} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">TJM (€)</label>
                            <input type="number" className="w-full border rounded-lg px-2.5 py-1.5 text-xs font-black text-navy outline-none" value={row.tjm} onChange={e => {
                               const next = [...internalStaffing];
                               const idx = next.findIndex(item => item.id === row.id);
                               if (idx !== -1) { next[idx].tjm = parseInt(e.target.value) || 0; setInternalStaffing(next); }
                            }} />
                          </div>
                        </div>
                        <div className="space-y-3 pt-2">
                          <div className="flex justify-between items-center"><label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5"><Percent size={12} className="text-blue-500" /> Charge</label><span className="text-xs font-black text-navy bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{row.percentage}%</span></div>
                          <input type="range" min="0" max="100" step="10" className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600" value={row.percentage} onChange={e => {
                              const next = [...internalStaffing];
                              const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].percentage = parseInt(e.target.value) || 0; setInternalStaffing(next); }
                          }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Externes Freelances */}
              <section className="space-y-6">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h4 className="font-black text-[10px] text-navy uppercase tracking-widest flex items-center gap-2"><Building2 size={18} className="text-orange-500" /> Externes Freelances (Staffing Prév.)</h4>
                  <button type="button" onClick={() => setFreelanceStaffing([...freelanceStaffing, { id: generateId(), firstName: '', lastName: '', entity: '', startDate: editingMission.startDate!, endDate: editingMission.endDate!, cjm: 800, tjm: 1200, percentage: 100 }])} className="text-[10px] font-black text-orange-600 hover:bg-orange-600 hover:text-white border border-orange-100 bg-orange-50/30 px-4 py-2 rounded-xl flex items-center gap-2 uppercase transition-all shadow-sm active:scale-95"><UserPlus size={16} /> Ajouter Freelance</button>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-6 snap-x no-scrollbar">
                  {freelanceStaffing.map((row) => (
                    <div key={row.id} className="w-[300px] shrink-0 p-5 border border-orange-100/50 rounded-2xl bg-orange-50/5 shadow-md relative group snap-start animate-in zoom-in duration-300">
                      <button type="button" onClick={(e) => handleRemoveStaffingRow(e, 'freelance', row.id)} className="absolute top-3 right-3 p-1.5 bg-red-50 text-red-500 hover:bg-red-600 hover:text-white rounded-full transition-all z-20 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                             <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Prénom</label>
                             <input placeholder="Prénom" className="w-full border-b py-1.5 text-xs font-black outline-none focus:border-orange-400 bg-transparent" value={row.firstName} onChange={e => {
                               const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                               if (idx !== -1) { next[idx].firstName = e.target.value; setFreelanceStaffing(next); }
                             }} />
                          </div>
                          <div className="space-y-1">
                             <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Nom</label>
                             <input placeholder="Nom" className="w-full border-b py-1.5 text-xs font-black outline-none focus:border-orange-400 bg-transparent" value={row.lastName} onChange={e => {
                               const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                               if (idx !== -1) { next[idx].lastName = e.target.value; setFreelanceStaffing(next); }
                             }} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Entité Juridique</label>
                          <input placeholder="Nom de l'entité..." className="w-full border-b py-1.5 text-xs font-black outline-none focus:border-orange-400 bg-transparent" value={row.entity} onChange={e => {
                            const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                            if (idx !== -1) { next[idx].entity = e.target.value; setFreelanceStaffing(next); }
                          }} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Début</label>
                              <input type="date" className="w-full text-[10px] border rounded-lg p-2 font-bold outline-none" value={row.startDate} onChange={e => {
                                const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                                if (idx !== -1) { next[idx].startDate = e.target.value; setFreelanceStaffing(next); }
                              }} />
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Fin</label>
                              <input type="date" className="w-full text-[10px] border rounded-lg p-2 font-bold outline-none" value={row.endDate} onChange={e => {
                                const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                                if (idx !== -1) { next[idx].endDate = e.target.value; setFreelanceStaffing(next); }
                              }} />
                           </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 items-end">
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">CJM (€)</label>
                            <input type="number" className="w-full border rounded-lg p-1.5 text-xs font-black text-navy outline-none shadow-sm" value={row.cjm} onChange={e => {
                              const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].cjm = parseInt(e.target.value) || 0; setFreelanceStaffing(next); }
                            }} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">TJM (€)</label>
                            <input type="number" className="w-full border rounded-lg p-1.5 text-xs font-black text-navy outline-none shadow-sm" value={row.tjm} onChange={e => {
                              const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].tjm = parseInt(e.target.value) || 0; setFreelanceStaffing(next); }
                            }} />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest">Charge</label>
                                <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-1 py-0.5 rounded border border-orange-100 leading-none">{row.percentage}%</span>
                            </div>
                            <input type="range" min="0" max="100" step="10" className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500" value={row.percentage} onChange={e => {
                                const next = [...freelanceStaffing]; const idx = next.findIndex(item => item.id === row.id);
                                if (idx !== -1) { next[idx].percentage = parseInt(e.target.value) || 0; setFreelanceStaffing(next); }
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Sous-traitants */}
              <section className="space-y-6 pb-4">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <h4 className="font-black text-[10px] text-navy uppercase tracking-widest flex items-center gap-2"><HardHat size={18} className="text-purple-500" /> Sous-traitants (Staffing Prév.)</h4>
                  <button type="button" onClick={() => setSubcontractorStaffing([...subcontractorStaffing, { id: generateId(), entity: '', startDate: editingMission.startDate!, endDate: editingMission.endDate!, amount: 10000, soldAmount: 15000, percentage: 100 }])} className="text-[10px] font-black text-purple-600 hover:bg-purple-600 hover:text-white border border-purple-100 bg-purple-50/30 px-4 py-2 rounded-xl flex items-center gap-2 uppercase transition-all shadow-sm active:scale-95"><UserPlus size={16} /> Ajouter Sous-traitant</button>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-6 snap-x no-scrollbar">
                  {subcontractorStaffing.map((row) => (
                    <div key={row.id} className="w-[300px] shrink-0 p-5 border border-purple-100/50 rounded-2xl bg-purple-50/5 shadow-md relative group snap-start animate-in zoom-in duration-300">
                      <button type="button" onClick={(e) => handleRemoveStaffingRow(e, 'subcontractor', row.id)} className="absolute top-3 right-3 p-1.5 bg-red-50 text-red-500 hover:bg-red-600 hover:text-white rounded-full transition-all z-20 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Entité Juridique</label>
                          <input placeholder="Nom de la société..." className="w-full border-b py-2 text-xs font-black text-navy outline-none focus:border-purple-500 bg-transparent" value={row.entity} onChange={e => {
                            const next = [...subcontractorStaffing]; const idx = next.findIndex(item => item.id === row.id);
                            if (idx !== -1) { next[idx].entity = e.target.value; setSubcontractorStaffing(next); }
                          }} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Début</label>
                              <input type="date" className="w-full text-[10px] border rounded-lg p-2 font-bold outline-none" value={row.startDate} onChange={e => {
                                const next = [...subcontractorStaffing]; const idx = next.findIndex(item => item.id === row.id);
                                if (idx !== -1) { next[idx].startDate = e.target.value; setSubcontractorStaffing(next); }
                              }} />
                           </div>
                           <div className="space-y-1">
                              <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Fin</label>
                              <input type="date" className="w-full text-[10px] border rounded-lg p-2 font-bold outline-none" value={row.endDate} onChange={e => {
                                const next = [...subcontractorStaffing]; const idx = next.findIndex(item => item.id === row.id);
                                if (idx !== -1) { next[idx].endDate = e.target.value; setSubcontractorStaffing(next); }
                              }} />
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 items-end">
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">Achat (€)</label>
                            <input type="number" className="w-full border rounded-lg p-2 text-xs font-black text-navy outline-none shadow-sm" value={row.amount} onChange={e => {
                              const next = [...subcontractorStaffing]; const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].amount = parseInt(e.target.value) || 0; setSubcontractorStaffing(next); }
                            }} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest">Vente (€)</label>
                            <input type="number" className="w-full border rounded-lg p-2 text-xs font-black text-navy outline-none shadow-sm" value={row.soldAmount} onChange={e => {
                              const next = [...subcontractorStaffing]; const idx = next.findIndex(item => item.id === row.id);
                              if (idx !== -1) { next[idx].soldAmount = parseInt(e.target.value) || 0; setSubcontractorStaffing(next); }
                            }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="sticky bottom-[-32px] bg-white pt-6 pb-4 border-t shadow-[0_-10px_20px_rgba(0,0,0,0.02)] flex justify-end gap-4 shrink-0 z-30">
                <button type="button" onClick={() => setEditingMission(null)} className="px-8 py-3.5 border border-gray-200 rounded-2xl font-black text-gray-400 uppercase text-[10px] tracking-widest hover:bg-gray-50 transition-all">Annuler</button>
                <button type="submit" className="px-10 py-3.5 bg-navy text-white rounded-2xl font-black shadow-xl flex items-center gap-3 hover:bg-navy/90 transition-all active:scale-95 group"><Save size={20} className="text-yellow-accent group-hover:scale-110 transition-transform" /> Sauvegarder Mission & Staffing</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {missionToDelete && (
        <div className="fixed inset-0 bg-navy/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in duration-200">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500">
                <AlertTriangle size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-black text-navy uppercase">Supprimer la mission ?</h3>
                <p className="text-gray-500 text-sm">
                  Cette action est irréversible. Toutes les données de planification associées seront également supprimées.
                </p>
              </div>
              <div className="flex w-full gap-3 pt-2">
                <button 
                  onClick={() => setMissionToDelete(null)}
                  className="flex-1 py-3 border border-gray-200 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={confirmDeleteMission}
                  className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-200"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Missions;