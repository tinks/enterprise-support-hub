import { useParams } from "react-router-dom";
import Conversations from "./Conversations";

const OwnerDashboard = () => {
  const { owner } = useParams<{ owner: string }>();
  const ownerName = owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";

  // Key forces a fresh Conversations instance per owner so all internal state
  // (filters, pagination, loaded rows) is rebuilt when navigating /my/<a> -> /my/<b>.
  return <Conversations key={ownerName} forceOwner={ownerName} />;
};

export default OwnerDashboard;
