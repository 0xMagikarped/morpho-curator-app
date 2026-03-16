export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-tertiary font-mono">Loading...</p>
      </div>
    </div>
  );
}
