import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanEdit } from "@/hooks/useCanEdit";

/**
 * Route wrapper for pages that only exist to CHANGE data (Triage, Dev
 * escalations, Import, Backlog, Flow, Knowledge). Read-only accounts get an
 * explanatory card instead of a surface where every control is disabled.
 *
 * UI gating only — RLS (`public.can_edit`) and `requireEditor` on the write
 * edge functions are the real enforcement.
 */
const EditorRoute = ({ children }: { children: React.ReactNode }) => {
  const { canEdit, isLoading } = useCanEdit();

  if (isLoading) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="p-6">
            <Skeleton className="h-48 w-full max-w-3xl" />
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  if (!canEdit) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="p-6">
            <Card className="max-w-3xl">
              <CardHeader>
                <CardTitle className="text-lg">Read-only access</CardTitle>
                <CardDescription>
                  This page changes ticket data, so it needs the editor role. Your account can view
                  reports, analytics, customers and the inbox views. Ask a Hub admin if you need
                  edit access.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
};

export default EditorRoute;
