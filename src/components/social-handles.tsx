import { SOCIAL_LINKS } from "@/lib/constants"

function SocialHandles() {
  return (
    <div className="mb-8">
      <div className="mb-6 text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">
          Connect With Me
        </h3>
        <div className="mx-auto h-0.5 w-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
      </div>

      <div className="mx-auto flex max-w-md flex-wrap justify-center gap-4 p-2">
        {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex min-w-0 flex-shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-muted-foreground shadow-sm transition-all duration-200 ease-out hover:border-primary/40 hover:text-foreground hover:shadow-lg hover:shadow-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 active:scale-95"
            aria-label={`Visit my ${label} profile`}
            style={{ willChange: "transform, box-shadow" }}>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"></div>

            <div className="relative z-10 flex-shrink-0 transition-transform duration-200 group-hover:scale-110">
              <Icon
                size={18}
                className="drop-shadow-sm transition-all duration-200 group-hover:drop-shadow-md"
              />
            </div>

            <span className="relative z-10 whitespace-nowrap text-sm font-medium tracking-wide transition-all duration-200 group-hover:text-foreground">
              {label}
            </span>

            <div className="absolute inset-0 -translate-x-full transform rounded-xl bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-all duration-700 ease-out group-hover:translate-x-full group-hover:opacity-100"></div>

            <div className="absolute inset-0 rounded-xl border border-primary/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100"></div>
          </a>
        ))}
      </div>

      <div className="mt-8 flex justify-center space-x-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-primary/40 to-primary/60 transition-all duration-300"
            style={{
              animation: `pulse 2s ease-in-out infinite`,
              animationDelay: `${i * 0.4}s`
            }}></div>
        ))}
      </div>
    </div>
  )
}

export default SocialHandles
