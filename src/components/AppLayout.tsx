import { NavLink } from "@/components/NavLink";
import { Settings, BarChart3, GitBranch, MessageSquare, BookOpen, Import, User } from "lucide-react";

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const linkClass = "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent";
  const activeClass = "bg-accent text-foreground";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <nav className="border-b border-border bg-card">
        <div className="mx-auto max-w-4xl flex items-center gap-1 px-6 py-2">
          <div className="flex items-center gap-2 mr-4">
            <img src="/lovable-logo.png" alt="Lovable" className="h-6 w-6" />
            <span className="text-sm font-semibold text-foreground hidden sm:inline">Lovable Enterprise Support Hub</span>
          </div>
          <NavLink to="/" className={linkClass} activeClassName={activeClass} end>
            <BarChart3 className="h-4 w-4" />
            Stats
          </NavLink>
          <NavLink to="/conversations" className={linkClass} activeClassName={activeClass}>
            <MessageSquare className="h-4 w-4" />
            Conversations
          </NavLink>
          <NavLink to="/my/joel" className={linkClass} activeClassName={activeClass}>
            <User className="h-4 w-4" />
            Joel
          </NavLink>
          <NavLink to="/my/kristina" className={linkClass} activeClassName={activeClass}>
            <User className="h-4 w-4" />
            Kristina
          </NavLink>
          <NavLink to="/import" className={linkClass} activeClassName={activeClass}>
            <Import className="h-4 w-4" />
            Import
          </NavLink>
          <NavLink to="/settings" className={linkClass} activeClassName={activeClass}>
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
          <NavLink to="/flow" className={linkClass} activeClassName={activeClass}>
            <GitBranch className="h-4 w-4" />
            Flow
          </NavLink>
          <NavLink to="/knowledge" className={linkClass} activeClassName={activeClass}>
            <BookOpen className="h-4 w-4" />
            Knowledge
          </NavLink>
        </div>
      </nav>
      <div className="h-0.5 bg-gradient-to-r from-[#FF6B6B] via-[#E66FD2] to-[#9B87F5]" />
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};

export default AppLayout;
