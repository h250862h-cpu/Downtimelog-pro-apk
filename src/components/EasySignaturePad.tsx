import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool } from 'lucide-react';

interface EasySignaturePadProps {
  label: string;
  signerName: string;
  onSignerNameChange?: (name: string) => void;
  signerNamePlaceholder?: string;
  value: string;
  onChange: (dataUrl: string) => void;
  requiredBadgeText?: string;
  accentColor?: 'navy' | 'emerald' | 'amber' | 'rose';
}

/**
 * Instant inline canvas signature pad modeled directly on DispatchSystemView's ReusableSignaturePad:
 * draw directly inside the card with finger or mouse — auto-saves immediately on pointer lift.
 */
export const EasySignaturePad: React.FC<EasySignaturePadProps> = ({
  label,
  signerName,
  onSignerNameChange,
  signerNamePlaceholder = 'Signer full name',
  value,
  onChange,
  requiredBadgeText = 'SIGN HERE',
  accentColor = 'navy',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Hydrate canvas if opening an existing signed card
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
  }, [value]);

  const getCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoords(e, canvas);
    ctx.strokeStyle =
      accentColor === 'emerald'
        ? '#047857'
        : accentColor === 'amber'
        ? '#b45309'
        : accentColor === 'rose'
        ? '#be123c'
        : '#0F1E36';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDraw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL('image/png'));
    }
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onChange('');
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-bold text-[#0F1E36] flex items-center gap-1.5 min-w-0">
          <PenTool className="h-3.5 w-3.5 text-[#0F1E36] shrink-0" />
          <span className="truncate">{label}</span>
          {value ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-800 border border-emerald-300 shrink-0">
              SIGNED
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 border border-amber-300 shrink-0">
              {requiredBadgeText}
            </span>
          )}
        </label>
        <button
          type="button"
          onClick={clearPad}
          className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-rose-700 transition shrink-0"
        >
          <Eraser className="h-3 w-3" />
          <span>Clear</span>
        </button>
      </div>

      {onSignerNameChange && (
        <input
          type="text"
          value={signerName}
          onChange={(e) => onSignerNameChange(e.target.value)}
          placeholder={signerNamePlaceholder}
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-[#0F1E36] focus:outline-none"
        />
      )}

      <div className="rounded-lg border border-dashed border-slate-300 bg-white overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          width={480}
          height={110}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
          className="w-full h-[84px] cursor-crosshair block"
        />
      </div>
      <p className="text-[10px] text-slate-500">Sign with finger or mouse directly above.</p>
    </div>
  );
};
