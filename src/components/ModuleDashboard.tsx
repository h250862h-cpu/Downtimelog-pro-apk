import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileSpreadsheet,
  HardHat,
  MessageSquare,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { ActiveAppModule } from '../types/attendance';
import { LgplastLogo } from './LgplastLogo';

interface ModuleDashboardProps {
  onSelectModule: (module: ActiveAppModule) => void;
  downtimeStats: { running: number; off: number; total: number };
  attendanceStats: { totalPhased: number; present: number; absent: number; casuals: number };
  qcStats: { totalInspections: number; passed: number; defects: number };
  userEmail: string;
  isAdmin: boolean;
}

export const ModuleDashboard: React.FC<ModuleDashboardProps> = ({
  onSelectModule,
  downtimeStats,
  attendanceStats,
  qcStats,
  userEmail,
  isAdmin,
}) => {
  return (
    <div className="space-y-6 max-w-6xl mx-auto py-2">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <LgplastLogo size="md" />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs font-bold text-amber-300">
                <ShieldCheck className="h-4 w-4" />
                <span>FACTORY CENTRAL MANAGEMENT SUITE</span>
              </span>
              {isAdmin && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase text-slate-950">
                  ADMIN ACTIVE
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
              Plant Operations &amp; Logs
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
              Welcome <b className="text-slate-200">{userEmail}</b>. Access your industrial equipment downtime log, factory staff WhatsApp attendance logger, and QC inspection module below:
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-3 px-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  System Mode
                </div>
                <div className="text-xs font-extrabold text-slate-200">
                  Online Synced APK
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Main Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Module 1: Downtime Log APK */}
        <div className="group flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-md hover:border-amber-500/50 hover:bg-slate-900 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 group-hover:scale-105 transition-transform">
                <Activity className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-amber-400 border border-slate-700">
                Downtime APK
              </span>
            </div>

            <h2 className="text-lg font-bold text-white mb-1.5 flex items-center gap-1.5">
              <span>Machinery Downtime Log</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Monitor operational status for 38+ plant machines, log breakdowns, digital signatures, 24h daily hours, and multi-sheet Excel period reports.
            </p>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/70 p-3 border border-slate-800 mb-5">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Running</span>
                <span className="text-base font-black text-emerald-400">
                  {downtimeStats.running} <span className="text-xs text-slate-500">units</span>
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Currently OFF</span>
                <span className={`text-base font-black ${downtimeStats.off > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                  {downtimeStats.off} <span className="text-xs text-slate-500">stopped</span>
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectModule('downtime')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 py-2.5 px-4 text-xs font-bold text-slate-950 shadow-md shadow-amber-950/40 transition active:scale-[0.98]"
          >
            <span>Open Downtime Log</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Module 2: Attendance Logger APK (WhatsApp Copy & Paste) */}
        <div className="group flex flex-col justify-between rounded-2xl border border-blue-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-md hover:border-blue-500/60 hover:bg-slate-900 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-400 border border-blue-500/30 group-hover:scale-105 transition-transform">
                <Users className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-blue-500/20 px-2.5 py-1 text-[11px] font-bold text-blue-300 border border-blue-500/30">
                WhatsApp Parser
              </span>
            </div>

            <h2 className="text-lg font-bold text-white mb-1.5 flex items-center gap-1.5">
              <span>Attendance Logger</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Paste WhatsApp shift attendance messages, auto-cross-reference staff roster, casuals, and generate multi-sheet Excel reports with date filters.
            </p>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/70 p-3 border border-slate-800 mb-5">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Present</span>
                <span className="text-base font-black text-emerald-400">
                  {attendanceStats.present} <span className="text-xs text-slate-500">staff</span>
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Absent</span>
                <span className={`text-base font-black ${attendanceStats.absent > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                  {attendanceStats.absent} <span className="text-xs text-slate-500">absent</span>
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectModule('attendance')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-2.5 px-4 text-xs font-bold text-white shadow-md shadow-blue-950/40 transition active:scale-[0.98]"
          >
            <span>Open Attendance Logger</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Module 3: QC Log (Quality Control) */}
        <div className="group flex flex-col justify-between rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-5 sm:p-6 shadow-md hover:border-emerald-500/60 hover:bg-slate-900 transition-all duration-200">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 group-hover:scale-105 transition-transform">
                <ClipboardCheck className="h-6 w-6" />
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-500/30">
                QC &amp; Inspection
              </span>
            </div>

            <h2 className="text-lg font-bold text-white mb-1.5 flex items-center gap-1.5">
              <span>QC Inspection Log</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Quality control testing per extrusion/moulding line, WhatsApp message copy-paste parser, defect logging, and inspection compliance reports.
            </p>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/70 p-3 border border-slate-800 mb-5">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Inspections</span>
                <span className="text-base font-black text-emerald-400">
                  {qcStats.totalInspections} <span className="text-xs text-slate-500">tests</span>
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Defects Logged</span>
                <span className={`text-base font-black ${qcStats.defects > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                  {qcStats.defects} <span className="text-xs text-slate-500">issues</span>
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => onSelectModule('qc')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 py-2.5 px-4 text-xs font-bold text-white shadow-md shadow-emerald-950/40 transition active:scale-[0.98]"
          >
            <span>Open QC Logger</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick Info Footer */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            <b>WhatsApp Copy &amp; Paste Support:</b> Directly paste attendance reports or shift QC updates from WhatsApp groups to auto-parse data.
          </span>
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          Firebase Sync: <span className="text-slate-300">downtime-log-d484f</span>
        </div>
      </div>
    </div>
  );
};
