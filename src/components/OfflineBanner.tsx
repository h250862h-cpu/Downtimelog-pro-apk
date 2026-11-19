import React from 'react';
import { WifiOff } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ isOnline }) => {
  if (isOnline) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-950">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            <strong>Offline Mode Active:</strong> Entries and signatures remain cached locally and will synchronize automatically upon network reconnection.
          </span>
        </div>
      </div>
    </div>
  );
};
