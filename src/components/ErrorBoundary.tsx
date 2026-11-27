import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const rawMsg = error instanceof Error ? error.message : String(error || 'Unexpected error');
    let friendly = rawMsg;
    if (rawMsg.startsWith('{') && rawMsg.includes('operationType')) {
      try {
        const parsed = JSON.parse(rawMsg);
        friendly = parsed.error || rawMsg;
      } catch {
        friendly = rawMsg;
      }
    }
    return { hasError: true, errorMessage: friendly };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error('LG PLAST Runtime Boundary caught error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">
                  Something interrupted this view
                </h1>
                <p className="text-xs text-slate-500">
                  Your saved plant records remain safe in local cache &amp; cloud sync.
                </p>
              </div>
            </div>

            {this.state.errorMessage && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 break-words font-mono">
                {this.state.errorMessage}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700"
              >
                Try Recovering View
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] hover:bg-[#193054] px-4 py-2 text-xs font-semibold text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reload App</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
