export default function EventList({ items, variant = "event-log", emptyText = "No events yet" }) {
  if (!items.length) {
    return <div className="empty">{emptyText}</div>;
  }

  return items.map((item, index) => {
    const eventName = item.data?.event || "activity";
    const feedVariant =
      variant === "live-feed"
        ? eventName.includes("voice")
          ? " voice"
          : eventName.includes("trigger")
            ? " alert"
            : ""
        : "";
    const className = variant === "live-feed" ? `feed-item${feedVariant}` : "event-item";
    const time = item.time instanceof Date ? item.time : new Date(item.time);

    return (
      <div key={`${time.getTime()}-${index}`} className={className}>
        <strong>
          {time.toLocaleTimeString()} - {eventName}
        </strong>
        {item.data?.message ? <div className="event-message">{item.data.message}</div> : null}
        <code>{JSON.stringify(item.data, null, 2)}</code>
      </div>
    );
  });
}
