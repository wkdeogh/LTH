type PageSkeletonProps = {
  variant?: 'home' | 'strategy' | 'records';
};

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span className={`skeleton-block ${className}`} aria-hidden="true" />;
}

export function PageSkeleton({ variant = 'home' }: PageSkeletonProps) {
  const isStrategy = variant === 'strategy';
  const cardCount = variant === 'home' ? 2 : variant === 'records' ? 3 : 2;

  return (
    <div className={`stack page-stack page-skeleton skeleton-${variant}`} role="status" aria-label="화면 불러오는 중">
      <span className="sr-only">화면을 불러오고 있습니다.</span>

      <section className="skeleton-hero" aria-hidden="true">
        <SkeletonBlock className="skeleton-eyebrow" />
        <SkeletonBlock className="skeleton-title" />
        <SkeletonBlock className="skeleton-copy" />
      </section>

      {isStrategy && (
        <div className="skeleton-tabs" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} />)}
        </div>
      )}

      <section className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: cardCount }, (_, index) => (
          <article className="panel skeleton-card" key={index}>
            <div className="skeleton-card-head">
              <SkeletonBlock className="skeleton-chip" />
              <SkeletonBlock className="skeleton-value" />
            </div>
            <SkeletonBlock className="skeleton-heading" />
            <SkeletonBlock className="skeleton-line" />
            <SkeletonBlock className="skeleton-line short" />
            <div className="skeleton-metrics">
              <SkeletonBlock />
              <SkeletonBlock />
              <SkeletonBlock />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
