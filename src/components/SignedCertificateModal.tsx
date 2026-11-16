import React from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck2,
  Printer,
  ShieldCheck,
  X,
} from 'lucide-react';
import { fmtT, r2, toTimestamp } from '../services/downtimeCalc';
import { DowntimeEntry } from '../types';
import { LgplastLogo } from './LgplastLogo';

interface SignedCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: DowntimeEntry | null;
}

export const SignedCertificateModal: React.FC<SignedCertificateModalProps> = ({
  isOpen,
  onClose,
  entry,
}) => {
  if (!isOpen || !entry) return null;

  const handlePrint = () => {
    window.print();
  };

  const sTime = toTimestamp(entry.start);
  const eTime = entry.end ? toTimestamp(entry.end) : Date.now();
  const hrs = r2((eTime - sTime) / 36e5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl my-auto text-slate-100 max-h-[92vh] flex flex-col">
        {/* Header - Not printed */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 print:hidden">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-wide">
              Verified & Digitally Signed Incident Certificate
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Certificate Body (Clean printable design) */}
        <div
          id="printable-certificate"
          className="overflow-y-auto pr-1 py-4 flex-1 space-y-4 print:p-0 print:text-black print:bg-white"
        >
          {/* Certificate Header Banner */}
          <div className="relative rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 p-5 print:border-slate-400 print:bg-white print:text-black">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2.5">
                  <LgplastLogo size="sm" />
                  <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300 print:bg-emerald-100 print:text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    ONLINE SIGNED & VERIFIED
                  </div>
                </div>
                <h2 className="text-xl font-black tracking-tight text-white print:text-black">
                  LGPLAST — EQUIPMENT DOWNTIME LOG CERTIFICATE
                </h2>
                <p className="text-xs text-slate-400 print:text-gray-600 font-mono mt-0.5">
                  RECORD REF: {entry.id} • FIREBASE SYNC ACTIVE
                </p>
              </div>

              {/* Official Seal Badge */}
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 p-2.5 text-center min-w-28 print:border-emerald-600">
                <Award className="h-6 w-6 text-emerald-400 print:text-emerald-700" />
                <span className="text-[10px] font-bold text-emerald-300 print:text-emerald-800 uppercase tracking-widest mt-1">
                  OFFICIAL LOG
                </span>
                <span className="text-[9px] text-emerald-400/80 font-mono">FIREBASE VERIFIED</span>
              </div>
            </div>
          </div>

          {/* Machine & Incident Info Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-lg border border-slate-800 bg-slate-850/60 p-2.5 print:border-gray-300 print:bg-gray-50">
              <span className="text-[10px] uppercase font-semibold text-slate-400 print:text-gray-600 block">
                Machine
              </span>
              <span className="text-sm font-bold text-amber-400 print:text-amber-700 font-mono">
                {entry.m}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-850/60 p-2.5 print:border-gray-300 print:bg-gray-50">
              <span className="text-[10px] uppercase font-semibold text-slate-400 print:text-gray-600 block">
                Category
              </span>
              <span className="text-sm font-semibold text-slate-200 print:text-gray-900">
                {entry.cat}
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-850/60 p-2.5 print:border-gray-300 print:bg-gray-50">
              <span className="text-[10px] uppercase font-semibold text-slate-400 print:text-gray-600 block">
                Downtime Duration
              </span>
              <span className="text-sm font-bold text-rose-400 print:text-rose-700">
                {hrs} hrs
              </span>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-850/60 p-2.5 print:border-gray-300 print:bg-gray-50">
              <span className="text-[10px] uppercase font-semibold text-slate-400 print:text-gray-600 block">
                Job Card
              </span>
              <span className="text-sm font-semibold text-slate-200 print:text-gray-900 font-mono">
                {entry.jcn || 'N/A'} ({entry.jcp || 'N/A'})
              </span>
            </div>
          </div>

          {/* Stoppage Interval */}
          <div className="rounded-lg border border-slate-800 bg-slate-850/60 p-3 print:border-gray-300 print:bg-gray-50">
            <span className="text-[10px] uppercase font-semibold text-slate-400 print:text-gray-600 block mb-0.5">
              Stoppage Interval
            </span>
            <div className="text-sm font-medium text-slate-200 print:text-gray-900">
              Stopped: <b>{fmtT(entry.start)}</b> — Running Again:{' '}
              <b>{entry.end ? fmtT(entry.end) : 'Still OFF'}</b>
            </div>
          </div>

          {/* Reason Details */}
          <div className="rounded-lg border border-slate-800 bg-slate-850/40 p-3 print:border-gray-300 print:bg-gray-50">
            <span className="font-semibold text-slate-300 print:text-gray-800 block mb-1">
              Reason / Fault Description:
            </span>
            <p className="text-slate-300 print:text-gray-700 leading-relaxed text-sm">
              {entry.reason || 'No description provided.'}
            </p>
          </div>

          {/* Digital Signatures Box (Side by Side) */}
          <div className="mt-4 border-t border-slate-800 pt-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 print:text-gray-700 mb-2">
              Digital Sign-off & Verification Seals
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Technician Signature */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 print:border-gray-400 print:bg-gray-50">
                <div className="flex items-center justify-between text-xs text-slate-400 print:text-gray-600 mb-1">
                  <span className="font-semibold">Person Reporting Sign-off</span>
                </div>
                <div className="text-sm font-bold text-slate-100 print:text-gray-900">
                  {entry.rep || 'Operator / Technician'}
                </div>

                <div className="my-2 h-16 rounded-lg bg-white/95 p-1 flex items-center justify-center border border-slate-200 shadow-inner">
                  {entry.signature ? (
                    <img
                      src={entry.signature}
                      alt="Reporter Signature"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400 italic">Signed Electronically</span>
                  )}
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 print:text-gray-500 font-mono">
                  <span>
                    Signed: {entry.signedAt ? new Date(entry.signedAt).toLocaleString() : 'Logged online'}
                  </span>
                  <span className="text-emerald-400 print:text-emerald-700 font-bold">✓ Verified</span>
                </div>
              </div>

              {/* Shift Supervisor Sign-off */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 print:border-gray-400 print:bg-gray-50">
                <div className="flex items-center justify-between text-xs text-slate-400 print:text-gray-600 mb-1">
                  <span className="font-semibold">Shift Supervisor / Authority</span>
                </div>
                <div className="text-sm font-bold text-slate-100 print:text-gray-900">
                  {entry.supervisorName || 'Plant Management'}
                </div>

                <div className="my-2 h-16 rounded-lg bg-white/95 p-1 flex items-center justify-center border border-slate-200 shadow-inner">
                  {entry.supervisorSignature ? (
                    <img
                      src={entry.supervisorSignature}
                      alt="Supervisor Signature"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400 italic">Authorized Record</span>
                  )}
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 print:text-gray-500 font-mono">
                  <span>Status: Active Record</span>
                  <span className="text-blue-400 print:text-blue-700 font-bold">✓ Secured</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 border-t border-slate-800 pt-3 flex items-center justify-between text-xs text-slate-400 print:hidden">
          <span>Synced with Firebase: downtime-log-d484f</span>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 font-medium text-slate-300 hover:bg-slate-750"
          >
            Close Certificate
          </button>
        </div>
      </div>
    </div>
  );
};
