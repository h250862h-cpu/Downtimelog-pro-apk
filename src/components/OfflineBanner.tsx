import React from 'react';
import { AlertCircle, WifiOff } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ isOnline }) => {
  if (isOnline) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            <strong>Plant Offline Mode Active:</strong> You can continue logging breakdowns and signing documents. All entries are safely encrypted locally and will automatically sync with Firebase when connection restores.
          </span>
        </div>
      </div>
    </div>
  );
};
