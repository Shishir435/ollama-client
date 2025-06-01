import { SOCIAL_LINKS } from "@/lib/constant"

function SocialHandles() {
  return (
    <div className="mb-8">
      <div className="mb-6 text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">
          Connect With Me
        </h3>
        <div className="mx-auto h-0.5 w-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
      </div>

      <div className="mx-auto flex max-w-md flex-wrap justify-center gap-3">
        {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex min-w-0 flex-shrink-0 transform items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-muted-foreground transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-105 hover:border-primary/50 hover:text-foreground hover:shadow-md hover:shadow-primary/10"
            aria-label={`Visit my ${label} profile`}>
            {/* Background gradient on hover */}
            <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>

            <div className="relative z-10 flex-shrink-0">
              <Icon
                size={18}
                className="transition-all duration-300 group-hover:rotate-3 group-hover:scale-110"
              />
            </div>

            <span className="relative z-10 whitespace-nowrap text-sm font-medium">
              {label}
            </span>

            <div className="absolute inset-0 -translate-x-full -skew-x-12 transform bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full"></div>
          </a>
        ))}
      </div>

      <div className="mt-6 flex justify-center space-x-1">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/30"
            style={{ animationDelay: `${i * 0.2}s` }}></div>
        ))}
      </div>
    </div>
  )
}

export default SocialHandles
