import AppLayout from "@/components/AppLayout";
import ImportTab from "@/components/ImportTab";

const ImportPage = () => {
  return (
    <AppLayout>
      <div className="p-6">
        <div className="mx-auto max-w-4xl w-full">
          <ImportTab />
        </div>
      </div>
    </AppLayout>
  );
};

export default ImportPage;
