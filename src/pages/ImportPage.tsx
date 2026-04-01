import AppLayout from "@/components/AppLayout";
import ImportTab from "@/components/ImportTab";
import ManualLogTab from "@/components/ManualLogTab";
import { Separator } from "@/components/ui/separator";

const ImportPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mx-auto max-w-4xl w-full space-y-8">
          <ImportTab />
          <Separator />
          <ManualLogTab />
        </div>
      </div>
    </AppLayout>
  );
};

export default ImportPage;
