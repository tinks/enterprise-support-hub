import { useParams } from "react-router-dom";
import Conversations from "./Conversations";

const OwnerDashboard = () => {
  const { owner } = useParams<{ owner: string }>();
  const ownerName = owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";

  return <Conversations forceOwner={ownerName} />;
};

export default OwnerDashboard;
