import { roomIcon, roomImage } from "../utils/helpers.js";
import LucideIcon from "./LucideIcon.jsx";

export default function RoomCard({ room, count, active }) {
  return (
    <article className={`room-card${active ? " active" : ""}`}>
      <div className="room-photo" aria-hidden="true">
        <img src={roomImage(room)} alt="" />
        <div className="room-icon">
          <LucideIcon name={roomIcon(room)} size={26} />
        </div>
      </div>
      <div className="room-card-body">
        <h4>{room}</h4>
        <div className="room-meta">
          <span>{count} Device{count === 1 ? "" : "s"}</span>
          <strong>{20 + (count % 7)}°C</strong>
        </div>
        <div className="room-online">
          <span className="green-dot" />
          All Online
        </div>
      </div>
    </article>
  );
}
