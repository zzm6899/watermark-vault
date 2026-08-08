export default function AlbumStatusControl({ proofing, value, bookingStatus, onChange }: {
  proofing: boolean;
  value: string;
  bookingStatus?: string;
  onChange: (value: string) => void;
}) {
  const color = proofing
    ? value === "proofing" ? "bg-yellow-500/15 text-yellow-400" : value === "selections-submitted" ? "bg-orange-500/15 text-orange-400" : value === "editing" ? "bg-blue-500/15 text-blue-400" : value === "finals-delivered" ? "bg-green-500/15 text-green-400" : "bg-secondary text-muted-foreground"
    : value === "editing" ? "bg-yellow-500/15 text-yellow-400" : value === "proofing" ? "bg-blue-500/15 text-blue-400" : value === "delivered" ? "bg-green-500/15 text-green-400" : "bg-secondary text-muted-foreground";
  const bookingColor = bookingStatus === "confirmed" ? "bg-emerald-500/15 text-emerald-400" : bookingStatus === "pending" ? "bg-amber-500/15 text-amber-400" : bookingStatus === "completed" ? "bg-blue-500/15 text-blue-400" : bookingStatus === "cancelled" ? "bg-red-500/15 text-red-400" : "bg-secondary text-muted-foreground";
  return <div className="flex items-center gap-1.5 flex-wrap">
    <select value={value} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onChange(event.target.value); }} className={`text-[10px] font-body px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-primary/50 ${color}`}>
      {proofing ? <>
        <option value="proofing">★ Proofing</option><option value="selections-submitted">⏳ Picks submitted</option><option value="editing">✏️ Editing</option><option value="finals-delivered">✓ Finals delivered</option>
      </> : <>
        <option value="editing">Editing</option><option value="proofing">Proofing</option><option value="delivered">Delivered</option><option value="archived">Archived</option>
      </>}
    </select>
    {bookingStatus && <span className={`text-[9px] font-body px-1.5 py-0.5 rounded-full ${bookingColor}`} title="Linked booking status">Booking: {bookingStatus}</span>}
  </div>;
}
