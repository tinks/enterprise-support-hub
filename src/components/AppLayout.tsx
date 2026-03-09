import { NavLink } from "@/components/NavLink";
import { Settings, BarChart3, GitBranch } from "lucide-react";

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const linkClass = "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent";
  const activeClass = "bg-accent text-foreground";

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card">
        <div className="mx-auto max-w-4xl flex items-center gap-1 px-6 py-2">
          <NavLink to="/" className={linkClass} activeClassName={activeClass} end>
            <BarChart3 className="h-4 w-4" />
            Stats
          </NavLink>
          <NavLink to="/settings" className={linkClass} activeClassName={activeClass}>
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
          <NavLink to="/flow" className={linkClass} activeClassName={activeClass}>
            <GitBranch className="h-4 w-4" />
            Flow
          </NavLink>
        </div>
      </nav>
      {children}
    </div>
  );
};

export default AppLayout;
