import React, { useState } from 'react';

interface LgplastLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  variant?: 'dark' | 'light';
  className?: string;
}

export const LGPLAST_LOGO_SRC = '/assets/aistudio/image_65f70fd7.png';

/**
 * Official LG PLAST Brand Logo ("Affordable / Durable / Complete")
 * Uses the official company logo image across the APK Dashboard, Login Screen,
 * Printable Certificates, and PDF/Excel Reports, with a clean vector fallback.
 */
export const LgplastLogo: React.FC<LgplastLogoProps> = ({
  size = 'md',
  showSubtitle = false,
  variant = 'dark',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const boxDims =
    size === 'lg'
      ? 'h-24 px-3.5 py-2 rounded-2xl'
      : size === 'sm'
      ? 'h-9 px-2 py-1 rounded-xl'
      : 'h-11 px-2.5 py-1 rounded-xl';

  const imgHeight =
    size === 'lg' ? 'h-20' : size === 'sm' ? 'h-7' : 'h-9';

  const borderStyle =
    variant === 'light'
      ? 'border border-sky-300 shadow-sm'
      : 'border border-sky-400/50 shadow-md shadow-blue-950/40';

  return (
    <div className={`inline-flex items-center gap-2.5 select-none shrink-0 ${className}`}>
      <div
        className={`inline-flex items-center justify-center bg-white ${boxDims} ${borderStyle} shrink-0`}
      >
        {!imgFailed ? (
          <img
            src={LGPLAST_LOGO_SRC}
            alt="LG PLAST - Affordable / Durable / Complete"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`${imgHeight} w-auto object-contain block`}
          />
        ) : (
          <div className="flex items-center gap-1.5 px-1">
            <svg viewBox="0 0 64 64" className="h-7 w-7 shrink-0" aria-hidden="true">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#2e3192" strokeWidth="4" />
              <circle cx="32" cy="32" r="22" fill="#2e3192" />
              <path d="M10 36 Q20 14 48 16 Q26 22 14 44 Z" fill="#ffffff" />
              <path d="M16 45 Q28 19 49 16 Q30 27 28 53 Z" fill="#00aeef" />
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-xs font-black tracking-wide text-[#00aeef]">LG PLAST</span>
              {showSubtitle && (
                <span className="text-[7px] font-bold text-slate-700">
                  Affordable / Durable / Complete
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
