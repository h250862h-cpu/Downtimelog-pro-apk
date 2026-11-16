import React from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Info,
  QrCode,
  Share2,
  Smartphone,
  X,
  Zap,
} from 'lucide-react';
import { LgplastLogo } from './LgplastLogo';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstallPrompt?: () => Promise<boolean>;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
}

export const DIRECT_APP_URL =
  typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://ais-pre-4lub2q7zy24orxc7ww4y2p-197466423672.europe-west2.run.app';

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  isOpen,
  onClose,
  onInstallPrompt,
  isInstallable,
  isInstalled,
  isIOS,
  isAndroid,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [showQR, setShowQR] = React.useState(false);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(DIRECT_APP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DowntimeLog Pro - Plant Machinery Logger',
          text: 'Open and install the DowntimeLog Pro APK on your device:',
          url: DIRECT_APP_URL,
        });
      } catch (e) {
        // user cancelled or share failed
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    DIRECT_APP_URL
  )}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl my-auto text-slate-100 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <LgplastLogo size="sm" />
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-100">
                Install LG PLAST APK &amp; 24/7 Direct Link
              </h3>
              <p className="text-xs text-slate-400">
                Install directly onto Android/iOS phones for always-live offline &amp; real-time sync
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto pr-1 py-4 space-y-4 text-xs text-slate-300 flex-1">
          {/* Important Notice Regarding "Remix to make this app your own" */}
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>Why did you see &quot;Remix to make this app your own&quot;?</span>
            </div>
            <p className="text-[11px] text-amber-100/90 leading-relaxed">
              You shared the <strong>AI Studio Developer Workspace link</strong> (which opens the project editor for programmers). To open the actual usable app:
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-amber-200 pl-1">
              <li>
                <strong>Option 1 (Instant):</strong> In the screen you opened, simply tap the <strong>&quot;Preview&quot;</strong> tab at the bottom right.
              </li>
              <li>
                <strong>Option 2 (Best):</strong> Share the <strong>Direct Standalone App Link</strong> below. It launches directly in full screen with zero builder prompts!
              </li>
            </ul>
          </div>

          {/* Direct Standalone App URL Card */}
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-300 uppercase tracking-wider text-[11px]">
                Direct Standalone App Link (Share This)
              </span>
              <button
                type="button"
                onClick={() => setShowQR(!showQR)}
                className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:underline"
              >
                <QrCode className="h-3.5 w-3.5" />
                {showQR ? 'Hide QR Code' : 'Scan Phone QR'}
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-emerald-200 break-all select-all">
              <span className="truncate flex-1">{DIRECT_APP_URL}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-slate-950 transition"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied Direct Link!' : 'Copy Direct App Link'}
              </button>

              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-xs font-semibold text-slate-200 transition"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share to WhatsApp / Staff</span>
              </button>

              {isInstallable && onInstallPrompt && !isInstalled && (
                <button
                  type="button"
                  onClick={() => onInstallPrompt()}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 px-3 py-1.5 text-xs font-black text-slate-950 transition shadow"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Install App Now</span>
                </button>
              )}

              <a
                href={DIRECT_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-xs font-semibold text-slate-200 transition ml-auto"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Full Tab</span>
              </a>
            </div>

            {/* QR Code Display */}
            {showQR && (
              <div className="mt-3 flex flex-col items-center justify-center p-4 rounded-xl bg-white border border-slate-200 text-slate-900 space-y-2">
                <img src={qrUrl} alt="App QR Code" className="h-44 w-44 object-contain" />
                <p className="text-[11px] font-semibold text-slate-600 text-center">
                  Point phone or tablet camera here to launch app instantly!
                </p>
              </div>
            )}
          </div>

          {/* Android Installation Instructions */}
          <div className="rounded-xl border border-slate-800 bg-slate-850 p-4 space-y-2">
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Download className="h-4 w-4 text-emerald-400" />
              How to Install as an App on Android (1 Tap)
            </h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300 pl-1 leading-relaxed">
              <li>
                Open the <strong>Direct Link</strong> above in Google Chrome on your phone.
              </li>
              <li>
                Tap the <strong>&quot;Get APK / Install App&quot;</strong> button in the top bar (or tap Chrome&apos;s three-dots <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300">⋮</code> menu ➔ <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>).
              </li>
              <li>
                Android will immediately generate a native application icon named <strong>DowntimeLog</strong> on your home screen.
              </li>
              <li>
                Tap the icon to launch in full screen with offline support and pen/stylus digital signature features!
              </li>
            </ol>
          </div>

          {/* Standalone .apk Package via PWABuilder */}
          <div className="rounded-xl border border-slate-800 bg-slate-850/80 p-4 space-y-2">
            <h4 className="text-sm font-bold text-white">
              Need a Standalone <span className="text-amber-400 font-mono">.APK</span> file?
            </h4>
            <p className="text-slate-300 leading-relaxed">
              If your plant IT requires a downloadable <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-300">.apk</code> installer file for sideloading onto company tablets without using the Play Store:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 pl-1">
              <li>Copy the Direct App URL above.</li>
              <li>Go to <strong className="text-slate-200">PWABuilder.com</strong> (by Microsoft).</li>
              <li>Paste the URL and click <strong className="text-slate-200">Package for Android</strong>.</li>
              <li>Download the compiled signed <code className="text-amber-300">.apk</code> file for free!</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 flex justify-end border-t border-slate-800 pt-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-750"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
