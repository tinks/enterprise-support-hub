import AppLayout from "@/components/AppLayout";
import AccessCard from "@/components/AccessCard";
import RolesCard from "@/components/RolesCard";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/useIsAdmin";

const Users = () => {
  const { isAdmin, isLoading } = useIsAdmin();

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Users</h1>
            <p className="text-sm text-muted-foreground">
              Who can sign in to the Hub, and who has admin.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Admin access required</CardTitle>
                <CardDescription>
                  Only Hub admins can view or change the access roster and roles. Ask an admin if you
                  need access.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <AccessCard />
              <RolesCard />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default Users;
