type BrandLogoProps = {
  size?: 'sm' | 'lg'
}

export function BrandLogo({ size = 'sm' }: BrandLogoProps) {
  const isLarge = size === 'lg'

  return (
    <span
      className={
        isLarge
          ? 'inline-flex flex-col items-center gap-3 text-center'
          : 'inline-flex items-center gap-2'
      }
    >
      <img
        src="/logo.svg"
        alt=""
        className={isLarge ? 'size-20 select-none' : 'size-6 select-none'}
        aria-hidden="true"
      />
      <span
        className={
          isLarge
            ? 'select-none text-5xl font-extrabold leading-none tracking-tight'
            : 'text-base tracking-tight'
        }
      >
        <span className="font-bold text-foreground">is</span>
        <span className="font-bold text-primary">safe</span>
        <span className="font-light text-muted-foreground">.store</span>
      </span>
    </span>
  )
}
