import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eraser, PenLine, RotateCcw, ShieldCheck, X } from 'lucide-react';

interface DigitalSignaturePadProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSignature: (data: {
    role: 'technician' | 'supervisor';
    name: string;
    badge: string;
    signature: string;
  }) => void;
  initialRole?: 'technician' | 'supervisor';
  initialName?: string;
  initialBadge?: string;
  logTitle?: string;
  equipmentId?: string;
}

export const DigitalSignaturePad: React.FC<DigitalSignaturePadProps> = ({
  isOpen,
  onClose,
  onSaveSignature,
  initialRole = 'technician',
  initialName = '',
  initialBadge = '',
  logTitle = '',
  equipmentId = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [role, setRole] = useState<'technician' | 'supervisor'>(initialRole);
  const [signerName, setSignerName] = useState(initialName);
  const [badgeId, setBadgeId] = useState(initialBadge);
  const [inkColor, setInkColor] = useState('#0f172a');
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [agreedToCompliance, setAgreedToCompliance] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  useEffect(() => {
    if (isOpen) {
      setRole(initialRole);
      setSignerName(initialName);
      setBadgeId(initialBadge);
      setAgreedToCompliance(false);
      setHasSignature(false);
      setHistory([]);

      // Setup canvas on next tick
      setTimeout(initCanvas, 50);
    }
  }, [isOpen, initialRole, initialName, initialBadge]);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI scaling
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clean background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Light guidelines for signature baseline
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(30, rect.height * 0.72);
    ctx.lineTo(rect.width - 30, rect.height * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);

    // Save initial state for undo
    const initialState = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialState]);
  };

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ('touches' in e && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else if ('clientX' in e) {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    return { x: 0, y: 0 };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.closePath();

    // Push snapshot to history
    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev, state]);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    initCanvas();
    setHasSignature(false);
  };

  const undoLastStroke = () => {
    if (history.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const newHistory = [...history];
    newHistory.pop(); // remove current
    const previous = newHistory[newHistory.length - 1];
    ctx.putImageData(previous, 0, 0);
    setHistory(newHistory);
    if (newHistory.length <= 1) {
      setHasSignature(false);
    }
  };

  const handleConfirm = () => {
    if (!signerName.trim()) {
      alert('Please enter your full name as the certifying official.');
      return;
    }
    if (!hasSignature) {
      alert('Please draw your digital signature on the pad.');
      return;
    }
    if (!agreedToCompliance) {
      alert('Please verify and check the digital certification declaration.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');

    onSaveSignature({
      role,
      name: signerName.trim(),
      badge: badgeId.trim() || (role === 'technician' ? 'TECH-AUTO' : 'SUP-AUTO'),
      signature: dataUrl,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl my-auto text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Official Online Digital Sign-off</h3>
              <p className="text-xs text-slate-400">
                Tamper-evident verification for {equipmentId || 'Equipment'} • {logTitle || 'Downtime Event'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="mt-4 space-y-4">
          {/* Role Selection */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
              Certifying Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('technician')}
                className={`flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium border transition-all ${
                  role === 'technician'
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 font-semibold'
                    : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <PenLine className="h-4 w-4" />
                Maintenance Technician
              </button>
              <button
                type="button"
                onClick={() => setRole('supervisor')}
                className={`flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-sm font-medium border transition-all ${
                  role === 'supervisor'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-400 font-semibold'
                    : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                Shift Supervisor / Engineer
              </button>
            </div>
          </div>

          {/* Signer Name & Badge */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Full Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder={role === 'technician' ? 'e.g. John Doe' : 'e.g. Sarah Moyo'}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-850 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                Employee / Badge ID
              </label>
              <input
                type="text"
                placeholder={role === 'technician' ? 'TECH-781' : 'SUP-104'}
                value={badgeId}
                onChange={(e) => setBadgeId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-850 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none uppercase font-mono"
              />
            </div>
          </div>

          {/* Signature Canvas Box */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Sign Online (Touch, Stylus or Mouse) <span className="text-rose-400">*</span>
              </span>
              <div className="flex items-center gap-2">
                {/* Ink Color Picker */}
                <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setInkColor('#0f172a')}
                    className={`h-4 w-4 rounded-full bg-slate-900 border ${
                      inkColor === '#0f172a' ? 'ring-2 ring-emerald-400' : 'opacity-60'
                    }`}
                    title="Black Ink"
                  />
                  <button
                    type="button"
                    onClick={() => setInkColor('#1e40af')}
                    className={`h-4 w-4 rounded-full bg-blue-700 border ${
                      inkColor === '#1e40af' ? 'ring-2 ring-emerald-400' : 'opacity-60'
                    }`}
                    title="Blue Ink"
                  />
                  <button
                    type="button"
                    onClick={() => setInkColor('#047857')}
                    className={`h-4 w-4 rounded-full bg-emerald-600 border ${
                      inkColor === '#047857' ? 'ring-2 ring-emerald-400' : 'opacity-60'
                    }`}
                    title="Emerald Ink"
                  />
                </div>

                <button
                  type="button"
                  onClick={undoLastStroke}
                  disabled={history.length <= 1}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-750 disabled:opacity-40 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Undo
                </button>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Eraser className="h-3 w-3" />
                  Clear
                </button>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-700 bg-white shadow-inner">
              <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="h-44 w-full touch-none cursor-crosshair"
              />
              {!hasSignature && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400 text-sm font-medium">
                  ✍️ Draw digital signature inside this box
                </div>
              )}
            </div>
            <div className="flex justify-between items-center text-[11px] text-slate-400 mt-1">
              <span>Timestamp: {new Date().toLocaleString()}</span>
              <span>Online Cloud Seal Enabled</span>
            </div>
          </div>

          {/* Compliance Checkbox */}
          <div className="rounded-xl border border-slate-800 bg-slate-850/80 p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToCompliance}
                onChange={(e) => setAgreedToCompliance(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                I hereby certify that the downtime details, corrective action, and equipment handover recorded in this log are accurate, true, and comply with standard plant operations and safety protocols.
              </span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-750 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-500 hover:to-teal-500 transition-all"
          >
            <CheckCircle2 className="h-4 w-4" />
            Affix & Certify Signature
          </button>
        </div>
      </div>
    </div>
  );
};
