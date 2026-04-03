import { useState } from "react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Settings, BarChart3, GitBranch, MessageSquare, BookOpen, Import, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { to: "/", icon: BarChart3, label: "Stats", end: true },
  { to: "/conversations", icon: MessageSquare, label: "Conversations" },
  { to: "/import", icon: Import, label: "Import" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/flow", icon: GitBranch, label: "Flow" },
  { to: "/knowledge", icon: BookOpen, label: "Knowledge" },
];

const dashboardItems = [
  { to: "/my/joel", label: "Joel" },
  { to: "/my/kristina", label: "Kristina" },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [expanded, setExpanded] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const location = useLocation();

  const isDashboardActive = dashboardItems.some((d) => location.pathname.startsWith(d.to));

  const linkBase =
    "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent whitespace-nowrap";
  const activeClass = "bg-accent text-foreground";

  return (
    <div className="h-screen flex flex-row overflow-hidden bg-background">
      {/* Vertical gradient accent */}
      <div className="w-0.5 bg-gradient-to-b from-[#FF6B6B] via-[#E66FD2] to-[#9B87F5] shrink-0" />

      {/* Sidebar */}
      <aside
        className="shrink-0 border-r border-border bg-card flex flex-col transition-all duration-200 ease-in-out relative z-20 overflow-visible"
        style={{ width: expanded ? 200 : 56 }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => { setExpanded(false); setFlyoutOpen(false); }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border min-h-[48px]">
          <img src="/lovable-logo.png" alt="Lovable" className="h-6 w-6 shrink-0" />
          {expanded && (
            <span className="text-sm font-semibold text-foreground truncate">Support hub</span>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col relative overflow-visible">
          <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
            <TooltipProvider delayDuration={0}>
              {navItems.slice(0, 2).map((item) => (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      {expanded && <span>{item.label}</span>}
                    </NavLink>
                  </TooltipTrigger>
                  {!expanded && <TooltipContent side="right">{item.label}</TooltipContent>}
                </Tooltip>
              ))}

              {/* Dashboards flyout group */}
              <div
                className="relative"
                onMouseEnter={() => setFlyoutOpen(true)}
                onMouseLeave={() => setFlyoutOpen(false)}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`${linkBase} cursor-default ${isDashboardActive ? activeClass : ""}`}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      {expanded && <span>Dashboards</span>}
                    </div>
                  </TooltipTrigger>
                  {!expanded && <TooltipContent side="right">Dashboards</TooltipContent>}
                </Tooltip>

                {flyoutOpen && (
                  <div className="absolute left-full top-0 py-1 px-1 bg-popover border border-border rounded-md shadow-md min-w-[140px] z-50">
                    {dashboardItems.map((d) => (
                      <NavLink
                        key={d.to}
                        to={d.to}
                        className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent whitespace-nowrap"
                        activeClassName={activeClass}
                      >
                        {d.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>

              {navItems.slice(2).map((item) => (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      {expanded && <span>{item.label}</span>}
                    </NavLink>
                  </TooltipTrigger>
                  {!expanded && <TooltipContent side="right">{item.label}</TooltipContent>}
                </Tooltip>
              ))}
            </TooltipProvider>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};

export default AppLayout;
