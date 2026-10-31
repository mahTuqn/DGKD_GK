import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AdminAuditorium, AdminCinema, AdminSummary, AdminUser, api, ApiError, businessDateOffset, formatVnd, Hold, Movie, Order, Role, Seat, SeatMap, SeatType, Session, Showtime, Ticket } from "./api";

type View = "discover" | "tickets" | "admin" | "scan";
type AuthMode = "login" | "register";
type BookingStep = "seats" | "checkout" | "success";
const SESSION_KEY = "cinemabooking.session";

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as Session | null; }
  catch { return null; }
}

function initials(value: string) { return value.trim().split(/\s+/).slice(-2).map((part) => part[0]).join("").toUpperCase(); }
function slugify(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function shortDate(date: string) { return new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${date}T12:00:00+07:00`)); }
function timeOf(value: string) { return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)); }
function humanError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "TICKET_ALREADY_USED") return "Vé này đã được sử dụng.";
    if (error.code === "SEAT_CONFLICT") return "Ghế vừa được người khác giữ. Hãy tải lại sơ đồ và chọn ghế khác.";
    if (error.code === "EMAIL_TAKEN") return "Email này đã được đăng ký.";
    if (error.code === "INVALID_CREDENTIALS") return "Email hoặc mật khẩu không chính xác.";
    if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    return error.message;
  }
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message) ? "Kết nối chưa ổn định. Vui lòng thử lại." : error instanceof Error ? error.message : "Kết nối chưa ổn định. Vui lòng thử lại.";
}

function useModalKeyboard(
  dialogRef: { current: HTMLElement | null },
  onEscape?: () => void,
  restoreFocusFallback?: { current: HTMLElement | null },
  preferRestoreFocusFallback = false,
) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const isTopDialog = () => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      return dialogs.item(dialogs.length - 1) === dialog;
    };
    const focusableItems = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((item) => item.getAttribute("aria-hidden") !== "true" && item.getClientRects().length > 0);
    const initialTarget = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") || focusableItems()[0] || dialog;
    const frame = window.requestAnimationFrame(() => {
      // The user may already have moved focus into the dialog before this frame.
      if (!dialog.contains(document.activeElement)) initialTarget.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      const fallbackTarget = restoreFocusFallback?.current;
      const hasFallback = fallbackTarget && fallbackTarget !== document.body && fallbackTarget.isConnected;
      const focusTarget = preferRestoreFocusFallback && hasFallback
        ? fallbackTarget
        : previousFocus && previousFocus !== document.body && previousFocus.isConnected
          ? previousFocus
          : fallbackTarget;
      if (focusTarget?.isConnected) window.requestAnimationFrame(() => {
        const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
        const topDialog = dialogs.item(dialogs.length - 1);
        if (topDialog && !topDialog.contains(focusTarget)) return;
        const activeElement = document.activeElement;
        if ((activeElement === document.body || activeElement === null || !activeElement.isConnected) && focusTarget.isConnected) focusTarget.focus();
      });
    };
  }, [restoreFocusFallback]);
}

function ModalKeyboardSupport({ dialogRef, onEscape, restoreFocusFallback }: {
  dialogRef: { current: HTMLElement | null };
  onEscape?: () => void;
  restoreFocusFallback?: { current: HTMLElement | null };
}) {
  useModalKeyboard(dialogRef, onEscape, restoreFocusFallback);
  return null;
}

function Poster({ movie, large = false, decorative = false }: { movie: Movie; large?: boolean; decorative?: boolean }) {
  const palettes = ["poster-violet", "poster-coral", "poster-blue", "poster-green", "poster-gold"];
  const color = palettes[(movie.title.length + movie.title.charCodeAt(0)) % palettes.length];
  return <div aria-hidden={decorative || undefined} className={`poster ${color} ${large ? "poster-large" : ""}`}>
    {movie.posterUrl ? <img src={movie.posterUrl} alt={`Áp phích phim ${movie.title}`} /> : <>
      <span className="poster-grain" aria-hidden="true" />
      <span className="poster-mark" aria-hidden="true">{initials(movie.title)}</span>
      <span className="poster-copy"><small>CINEMA PREMIERE</small><b>{movie.title}</b><i>{movie.genre}</i></span>
      <span className="poster-age">{movie.ageRating || "P"}</span>
    </>}
  </div>;
}

function AuthDialog({ mode, setMode, onClose, onSuccess, restoreFocusFallback }: { mode: AuthMode; setMode: (mode: AuthMode) => void; onClose: () => void; onSuccess: (session: Session) => void; restoreFocusFallback: { current: HTMLElement | null } }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const restoreSubmitFocusRef = useRef(false);
  useModalKeyboard(dialogRef, onClose, restoreFocusFallback, true);
  useEffect(() => {
    if (busy || !error || !restoreSubmitFocusRef.current) return;
    restoreSubmitFocusRef.current = false;
    if (document.activeElement === document.body) submitRef.current?.focus();
  }, [busy, error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); restoreSubmitFocusRef.current = document.activeElement === submitRef.current; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try {
      const session = mode === "login"
        ? await api.login(String(form.get("email")), String(form.get("password")))
        : await api.register(String(form.get("name")), String(form.get("email")), String(form.get("password")));
      onSuccess(session);
    } catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  }
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1}>
      <button className="icon-button dialog-close" aria-label="Đóng" onClick={onClose}>×</button>
      <span className="eyebrow">CINEMA CLUB</span>
      <h2 id="auth-title">{mode === "login" ? "Chào bạn, mình vào rạp nhé." : "Tạo tài khoản mới"}</h2>
      <p className="muted">Đăng nhập để giữ ghế và lưu vé của bạn.</p>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && <label className="field-label">Họ và tên<input name="name" autoComplete="name" required minLength={2} placeholder="Tên của bạn" /></label>}
        <label className="field-label">Email<input aria-label="Email" name="email" type="email" autoComplete="email" required placeholder="ban@email.com" data-dialog-autofocus /></label>
        <label className="field-label">Mật khẩu<input aria-label="Mật khẩu" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} placeholder="Ít nhất 8 ký tự" /></label>
        {error && <p role="alert" className="alert alert-error">{error}</p>}
        <button ref={submitRef} className="button button-primary button-wide" disabled={busy}>{busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button>
      </form>
      <p className="auth-switch">{mode === "login" ? "Bạn chưa có tài khoản?" : "Bạn đã có tài khoản?"} <button className="text-button" onClick={() => { setError(""); setMode(mode === "login" ? "register" : "login"); }}>{mode === "login" ? "Tạo tài khoản mới" : "Đăng nhập"}</button></p>
      {mode === "login" && <div className="demo-note">Demo: customer@cinema.local<br />Mật khẩu: CinemaCustomer123!</div>}
    </section>
  </div>;
}

function SeatDialog({ showtime, session, isTopModal, onClose, onRequireAuth, onHoldCreated, restoreFocusFallback }: {
  showtime: Showtime; session: Session | null; isTopModal: boolean; onClose: () => void; onRequireAuth: (showtimeId: string, seatIds: string[]) => void; onHoldCreated: (hold: Hold, seatMap: SeatMap) => void; restoreFocusFallback: { current: HTMLElement | null };
}) {
  const [seatMap, setSeatMap] = useState<SeatMap | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [limitNotice, setLimitNotice] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalKeyboard(dialogRef, onClose, restoreFocusFallback, true);
  const refresh = async () => { setLoading(true); setError(""); setLimitNotice(""); try { const value = await api.seats(showtime.id); setSeatMap(value); setSelected([]); } catch (reason) { setError(humanError(reason)); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, [showtime.id]);
  const rows = useMemo(() => {
    const grouped = new Map<string, Seat[]>();
    for (const seat of seatMap?.seats || []) grouped.set(seat.row, [...(grouped.get(seat.row) || []), seat]);
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "vi", { numeric: true })).map(([row, seats]) => [row, seats.sort((a, b) => a.column - b.column)] as const);
  }, [seatMap]);
  const total = (seatMap?.seats || []).filter((seat) => selected.includes(seat.id)).reduce((sum, seat) => sum + (seat.priceVnd ?? seatMap?.showtime.priceVnd ?? showtime.priceVnd), 0);
  function toggle(seat: Seat) {
    if (seat.status !== "AVAILABLE") return;
    if (!selected.includes(seat.id) && selected.length >= 8) {
      setLimitNotice("Mỗi đơn tối đa 8 ghế. Hãy bỏ chọn một ghế trước khi chọn ghế khác.");
      return;
    }
    setLimitNotice("");
    setSelected((current) => current.includes(seat.id) ? current.filter((id) => id !== seat.id) : [...current, seat.id]);
  }
  async function holdSeats() {
    if (!selected.length) return;
    if (!session) { onRequireAuth(showtime.id, selected); return; }
    setBusy(true); setError("");
    try { const hold = await api.createHold(session.token, showtime.id, selected); if (!seatMap) return; onHoldCreated(hold, seatMap); }
    catch (reason) {
      const message = humanError(reason);
      if (reason instanceof ApiError && reason.status === 409) {
        await refresh();
        setError(message);
      } else setError(message);
    }
    finally { setBusy(false); }
  }
  return <div className="overlay booking-overlay" role="presentation" inert={!isTopModal || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="dialog seat-dialog" role="dialog" aria-modal={isTopModal} aria-labelledby="seat-title" tabIndex={-1}>
      <div className="dialog-top"><div><span className="eyebrow">CHỌN CHỖ NGỒI</span><h2 id="seat-title">{showtime.movieTitle}</h2><p className="muted">{showtime.cinemaName} · {showtime.auditoriumName} · {shortDate(showtime.date)} · {timeOf(showtime.startAt)}</p></div><button className="icon-button" aria-label="Đóng" onClick={onClose}>×</button></div>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      {loading ? <div className="seat-loading"><span className="spinner" />Đang tải sơ đồ ghế…</div> : seatMap && <>
        <div className="screen-wrap"><div className="screen-line" /><span>MÀN HÌNH</span></div>
        <div className="seat-map" aria-label="Sơ đồ ghế">
          {rows.map(([row, seats]) => <div className="seat-row" key={row}><span className="row-label">{row}</span>{seats.map((seat) => {
            const pressed = selected.includes(seat.id); const status = seat.status.toLowerCase();
            const statusLabel = status === "available" ? "trống" : status === "held" ? "đang giữ" : "đã bán";
            const isAccessible = seat.isAccessible || seat.type === "ACCESSIBLE";
            const typeLabel = isAccessible ? "ghế hỗ trợ tiếp cận" : seat.type === "PREMIUM" ? "ghế cao cấp" : "ghế tiêu chuẩn";
            return <button key={seat.id} data-testid="seat" aria-label={`Ghế ${seat.row} ${seat.column} — ${statusLabel} — ${typeLabel}`} aria-pressed={pressed} title={`${seat.label} · ${seat.type}`} disabled={seat.status !== "AVAILABLE"} onClick={() => toggle(seat)} className={`seat ${status} ${pressed ? "selected" : ""} ${isAccessible ? "accessible" : ""}`}>{seat.label.replace(row, "")}</button>;
          })}<span className="row-label">{row}</span></div>)}
        </div>
        <div className="seat-legend"><span><i className="seat-dot available" /> Còn trống</span><span><i className="seat-dot selected" /> Đang chọn</span><span><i className="seat-dot held" /> Đang giữ</span><span><i className="seat-dot sold" /> Đã bán</span></div>
        {selected.length >= 8 && <p className="muted tiny">Mỗi đơn tối đa 8 ghế.</p>}
        <p role="status" className={limitNotice ? "alert alert-error" : "sr-only"}>{limitNotice}</p>
        <div className="seat-footer"><div><span className="muted">{selected.length ? `${selected.length} ghế đã chọn` : "Chọn tối đa 8 ghế"}</span><b>{formatVnd(total)}</b></div><button data-testid="hold-submit" className="button button-primary" disabled={!selected.length || busy} onClick={() => void holdSeats()}>{busy ? "Đang giữ ghế…" : "Giữ ghế"}<span aria-hidden="true">→</span></button></div>
      </>}
    </section>
  </div>;
}

function TicketCard({ order }: { order: Order }) {
  return <article data-testid="ticket-card" className="ticket-card">
    <div className="ticket-main"><div className="ticket-meta"><span className="status-pill status-confirmed">{order.status === "CONFIRMED" ? "ĐÃ THANH TOÁN" : order.status}</span><span className="muted">Mã đơn #{order.id.slice(-8).toUpperCase()}</span></div>
      <h3>{order.showtime.movieTitle}</h3><p className="muted">{order.showtime.cinemaName} · {order.showtime.auditoriumName}</p>
      <div className="ticket-details"><div><span>Ngày chiếu</span><b>{shortDate(order.showtime.date)}</b></div><div><span>Giờ bắt đầu</span><b>{timeOf(order.showtime.startAt)}</b></div><div><span>Ghế</span><b>{order.seats.map((seat) => seat.label).join(", ")}</b></div></div>
      <div className="ticket-bottom"><span>{formatVnd(order.totalVnd)}</span><span>{order.tickets.filter((ticket) => ticket.checkedInAt).length}/{order.tickets.length} vé đã vào</span></div>
    </div>
    <div className="ticket-codes">{order.tickets.map((ticket, index) => <div className="ticket-code" key={ticket.id} aria-label="Mã vé QR">
      <QRCodeSVG value={ticket.qrToken} title={`Mã QR vé ${ticket.id.slice(-8).toUpperCase()}`} size={108} bgColor="#ffffff" fgColor="#151515" level="M" />
      <b>{ticket.seatLabel ? `Ghế ${ticket.seatLabel}` : `Vé ${index + 1}`}</b>
      <span>{ticket.checkedInAt ? "Đã vào rạp" : "Chưa vào rạp"}</span>
      <small>Tham chiếu · {ticket.id.slice(-8).toUpperCase()}</small>
      <details className="ticket-manual-code"><summary>Hiển thị mã soát vé · vé {index + 1}</summary>
        <label>Nội dung mã QR vé {index + 1} · {ticket.id.slice(-8).toUpperCase()}<textarea readOnly rows={3} value={ticket.qrToken} spellCheck={false} /></label>
        <p>Chỉ cung cấp mã này cho nhân viên soát vé.</p>
      </details>
    </div>)}</div>
  </article>;
}

function AdminPanel({ session }: { session: Session }) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [movies, setMovies] = useState<Movie[]>([]); const [cinemas, setCinemas] = useState<AdminCinema[]>([]);
  const [auditoriums, setAuditoriums] = useState<AdminAuditorium[]>([]); const [adminShowtimes, setAdminShowtimes] = useState<Showtime[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]); const [usersNextCursor, setUsersNextCursor] = useState<string | null>(null); const [usersLoading, setUsersLoading] = useState(false);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const adminViewRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<{ target: HTMLElement; fallback: HTMLElement | null } | null>(null);
  function rememberActionFocus() {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement) || !adminViewRef.current?.contains(target)) return;
    pendingFocusRef.current = { target, fallback: target.closest("section")?.querySelector<HTMLElement>("h2") || adminViewRef.current };
  }
  useEffect(() => {
    if (busy || usersLoading || !pendingFocusRef.current) return;
    const { target, fallback } = pendingFocusRef.current;
    pendingFocusRef.current = null;
    // Do not take focus away if the user moved elsewhere during the request.
    if (document.activeElement !== document.body) return;
    if (target.isConnected && target.getClientRects().length && !target.matches(":disabled")) target.focus();
    else if (fallback?.isConnected && fallback.getClientRects().length) { fallback.tabIndex = -1; fallback.focus(); }
  }, [busy, usersLoading]);
  const load = async () => { try { const [s, m, c, a, st, users] = await Promise.all([api.adminSummary(session.token), api.adminMovies(session.token), api.adminCinemas(session.token), api.auditoriums(session.token), api.adminShowtimes(session.token), api.adminUsers(session.token)]); setSummary(s); setMovies(m); setCinemas(c); setAuditoriums(a); setAdminShowtimes(st); setAdminUsers(users.items); setUsersNextCursor(users.nextCursor); } catch (reason) { setError(humanError(reason)); } };
  useEffect(() => { void load(); }, []);
  async function runAdminAction(action: () => Promise<unknown>, successMessage: string): Promise<boolean> {
    rememberActionFocus(); setBusy(true); setNotice(""); setError("");
    try { await action(); setNotice(successMessage); await load(); return true; }
    catch (reason) { setError(humanError(reason)); return false; }
    finally { setBusy(false); }
  }
  async function createMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; rememberActionFocus(); setBusy(true); setNotice(""); setError(""); const form = new FormData(formElement); const title = String(form.get("title")); const releaseDate = String(form.get("releaseDate"));
    try { await api.createMovie(session.token, { title, slug: slugify(title), genre: String(form.get("genre")), synopsis: String(form.get("synopsis")), runtimeMinutes: Number(form.get("runtimeMinutes")), ageRating: String(form.get("ageRating")), ...(releaseDate ? { releaseDate } : {}) }); setNotice("Đã thêm phim mới."); formElement.reset(); await load(); }
    catch (reason) { setError(humanError(reason)); } finally { setBusy(false); }
  }
  async function updateMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.movieId;
    if (!id) return;
    const title = String(values.get("title")).trim(); const releaseDate = String(values.get("releaseDate")).trim();
    await runAdminAction(() => api.updateMovie(session.token, id, {
      title, slug: slugify(title), genre: String(values.get("genre")), synopsis: String(values.get("synopsis")),
      runtimeMinutes: Number(values.get("runtimeMinutes")), ageRating: String(values.get("ageRating")),
      releaseDate: releaseDate || null, status: String(values.get("status")) as "ACTIVE" | "INACTIVE"
    }), "Đã cập nhật phim.");
  }
  async function createCinema(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    if (await runAdminAction(() => api.createCinema(session.token, { name: String(form.get("name")), city: String(form.get("city")), address: String(form.get("address")) }), "Đã thêm rạp mới.")) formElement.reset();
  }
  async function createAuditorium(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const rows = Number(form.get("rows")); const columns = Number(form.get("columns"));
    if (rows * columns > 300) { setError("Mỗi phòng tối đa 300 ghế. Hãy giảm số hàng hoặc cột."); return; }
    const seats = Array.from({ length: rows }, (_, rowIndex) => {
      const row = String.fromCharCode(65 + rowIndex);
      return Array.from({ length: columns }, (_, columnIndex) => ({ label: `${row}${columnIndex + 1}`, row, column: columnIndex + 1, type: "STANDARD" as const }));
    }).flat();
    if (await runAdminAction(() => api.createAuditorium(session.token, { cinemaId: String(form.get("cinemaId")), name: String(form.get("name")), screenType: String(form.get("screenType")), seats }), "Đã tạo phòng và sơ đồ ghế.")) formElement.reset();
  }
  async function createShowtime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; rememberActionFocus(); setBusy(true); setNotice(""); setError(""); const form = new FormData(formElement);
    try { await api.createShowtime(session.token, { movieId: String(form.get("movieId")), auditoriumId: String(form.get("auditoriumId")), startAt: new Date(String(form.get("startAt"))).toISOString(), priceVnd: Number(form.get("priceVnd")) }); setNotice("Đã tạo suất chiếu."); formElement.reset(); await load(); }
    catch (reason) { setError(humanError(reason)); } finally { setBusy(false); }
  }
  async function updateCinemaStatus(cinema: AdminCinema) {
    await runAdminAction(() => api.updateCinema(session.token, cinema.id, { status: cinema.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }), "Đã cập nhật trạng thái rạp.");
  }
  async function updateAuditorium(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.auditoriumId;
    if (!id) return;
    await runAdminAction(() => api.updateAuditorium(session.token, id, { name: String(values.get("name")), screenType: String(values.get("screenType")) }), "Đã cập nhật thông tin phòng.");
  }
  async function updateSeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.seatId;
    if (!id) return;
    const row = String(values.get("row")).trim().toUpperCase(); const column = Number(values.get("column"));
    const type = String(values.get("type")) as SeatType;
    await runAdminAction(() => api.updateSeat(session.token, id, {
      row, column, label: `${row}${column}`, type, isAccessible: type === "ACCESSIBLE"
    }), "Đã cập nhật sơ đồ ghế.");
  }
  async function updateShowtime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.showtimeId;
    if (!id) return;
    await runAdminAction(() => api.updateShowtime(session.token, id, { priceVnd: Number(values.get("priceVnd")), premiumSurchargeVnd: Number(values.get("premiumSurchargeVnd")), status: String(values.get("status")) as "ACTIVE" | "INACTIVE" }), "Đã cập nhật giá và trạng thái suất chiếu.");
  }
  async function updateAdminUserRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.userId;
    if (!id) return;
    await runAdminAction(() => api.updateUserRole(session.token, id, String(values.get("role")) as Role), "Đã cập nhật vai trò người dùng.");
  }
  async function updateAdminUserCinema(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const id = form.dataset.userId;
    if (!id) return;
    const cinemaId = String(values.get("cinemaId")) || null;
    await runAdminAction(() => api.assignUserCinema(session.token, id, cinemaId), "Đã cập nhật rạp phân công cho Staff.");
  }
  async function loadMoreAdminUsers() {
    if (!usersNextCursor || usersLoading) return;
    rememberActionFocus();
    setUsersLoading(true);
    try {
      const page = await api.adminUsers(session.token, usersNextCursor);
      setAdminUsers((current) => [...current, ...page.items]);
      setUsersNextCursor(page.nextCursor);
    } catch (reason) { setError(humanError(reason)); }
    finally { setUsersLoading(false); }
  }
  const occupancy = summary?.occupancy;
  const fillRate = occupancy?.fillRatePercent ?? 0;
  return <div ref={adminViewRef} className="admin-view" tabIndex={-1}>
    <div className="section-heading"><div><span className="eyebrow">STUDIO CONTROL</span><h1>Vận hành rạp phim</h1><p className="muted">Quản lý lịch chiếu và theo dõi hoạt động đặt vé.</p></div><span className="role-badge">ADMIN</span></div>
    {error && <p role="alert" className="alert alert-error">{error}</p>}{notice && <p role="status" className="alert alert-success">{notice}</p>}
    <div className="admin-metrics">{[["Phim đang chiếu", summary?.movies ?? "—"], ["Suất chiếu", summary?.showtimes ?? "—"], ["Đơn đặt vé", summary?.orders ?? "—"], ["Vé đã phát", summary?.tickets ?? "—"]].map(([label, value]) => <div className="metric-card" key={label}><span>{label}</span><b>{value}</b></div>)}<div className="metric-card"><span>Tỉ lệ lấp đầy</span><b>{occupancy ? `${fillRate.toFixed(1)}%` : "—"}</b></div><div className="metric-card metric-revenue"><span>Doanh thu xác nhận</span><b>{summary ? formatVnd(summary.confirmedRevenueVnd) : "—"}</b></div></div>
    <section className="panel occupancy-panel"><div className="panel-title"><span className="eyebrow">OCCUPANCY · SUẤT CHƯA BẮT ĐẦU</span><h2>Mức lấp đầy chỗ ngồi</h2></div><div className="occupancy-summary"><b>{occupancy ? `${occupancy.soldSeats.toLocaleString("vi-VN")} / ${occupancy.capacitySeats.toLocaleString("vi-VN")} ghế đã bán` : "Đang tải dữ liệu…"}</b><span>{occupancy ? `${occupancy.showtimeCount} suất đang mở` : ""}</span></div><progress className="occupancy-track" aria-label="Tỉ lệ lấp đầy ghế" value={Math.max(0, Math.min(fillRate, 100))} max={100}>{fillRate}%</progress><p className="muted tiny">{occupancy?.definition || "Tỉ lệ ghế đã bán trên tổng số ghế của các suất ACTIVE chưa bắt đầu."}</p></section>
    <div className="admin-grid"><section className="panel"><div className="panel-title"><span className="eyebrow">CATALOG</span><h2>Thêm phim</h2></div><form className="form-stack" onSubmit={createMovie}><label className="field-label">Tên phim<input name="title" required minLength={2} /></label><div className="form-grid"><label className="field-label">Thể loại<input name="genre" required placeholder="Tâm lý, Hành động…" /></label><label className="field-label">Phân loại<input name="ageRating" required defaultValue="T16" /></label></div><label className="field-label">Thời lượng (phút)<input type="number" name="runtimeMinutes" required min={30} max={300} defaultValue={110} /></label><label className="field-label">Ngày khởi chiếu<input type="date" name="releaseDate" /></label><label className="field-label">Tóm tắt<textarea name="synopsis" rows={3} required minLength={10} /></label><button className="button button-primary" disabled={busy}>Thêm vào danh mục</button></form></section>
      <section className="panel"><div className="panel-title"><span className="eyebrow">SCHEDULE</span><h2>Tạo suất chiếu</h2></div><form className="form-stack" onSubmit={createShowtime}><label className="field-label">Phim<select name="movieId" required>{movies.map((movie) => <option key={movie.id} value={movie.id}>{movie.title}</option>)}</select></label><label className="field-label">Phòng<select name="auditoriumId" required>{auditoriums.map((room) => <option key={room.id} value={room.id}>{room.cinemaName} · {room.name} ({room.seatCount} ghế)</option>)}</select></label><label className="field-label">Thời gian bắt đầu<input name="startAt" type="datetime-local" required /></label><label className="field-label">Giá vé (VND)<input type="number" name="priceVnd" min={1000} max={1000000} step={1000} defaultValue={85000} required /></label><button className="button button-primary" disabled={busy || !movies.length || !auditoriums.length}>Tạo suất chiếu</button></form></section></div>
    <section className="panel admin-section"><div className="panel-title"><span className="eyebrow">MOVIE CONTROL</span><h2>Chỉnh sửa phim</h2></div><div className="admin-record-list">{movies.map((movie) => <details className="admin-record-detail" key={movie.id}><summary><b>{movie.title}</b><span>{movie.genre} · {movie.ageRating} · {movie.status === "INACTIVE" ? "Tạm ẩn" : "Đang hoạt động"}</span></summary><form className="form-stack admin-edit-form" data-movie-id={movie.id} data-testid={`admin-movie-edit-form-${movie.id}`} aria-label={`Chỉnh sửa phim ${movie.title}`} onSubmit={updateMovie}><div className="form-grid"><label className="field-label">Tên phim<input name="title" defaultValue={movie.title} required minLength={2} maxLength={160} /></label><label className="field-label">Slug<input value={slugify(movie.title)} readOnly aria-label="Slug tự tạo theo tên phim" /></label></div><div className="form-grid"><label className="field-label">Thể loại<input name="genre" defaultValue={movie.genre} required minLength={2} maxLength={80} /></label><label className="field-label">Phân loại<input name="ageRating" defaultValue={movie.ageRating || "P"} required maxLength={12} /></label></div><div className="form-grid"><label className="field-label">Thời lượng (phút)<input type="number" name="runtimeMinutes" defaultValue={movie.runtimeMinutes} required min={30} max={300} /></label><label className="field-label">Ngày khởi chiếu<input type="date" name="releaseDate" defaultValue={movie.releaseDate?.slice(0, 10) || ""} /></label></div><label className="field-label">Tóm tắt<textarea name="synopsis" defaultValue={movie.synopsis} required minLength={10} maxLength={3000} rows={3} /></label><div className="form-grid"><label className="field-label">Trạng thái<select name="status" defaultValue={movie.status || "ACTIVE"}><option value="ACTIVE">Đang hoạt động</option><option value="INACTIVE">Tạm ẩn</option></select></label><button className="button button-outline button-small" disabled={busy}>Lưu phim</button></div><small className="muted">Slug được tạo lại từ tên phim. Phim đã có lịch sử được tạm ẩn thay vì xóa.</small></form></details>)}{!movies.length && <p className="muted">Chưa có phim trong danh mục.</p>}</div></section>
    <div className="admin-grid admin-management-grid">
      <section className="panel"><div className="panel-title"><span className="eyebrow">CINEMAS</span><h2>Quản lý rạp</h2></div><form className="form-stack admin-create-form" onSubmit={createCinema}><label className="field-label">Tên rạp<input name="name" required minLength={2} /></label><div className="form-grid"><label className="field-label">Thành phố<input name="city" required minLength={2} /></label><label className="field-label">Địa chỉ<input name="address" required minLength={5} /></label></div><button className="button button-primary" disabled={busy}>Thêm rạp</button></form><div className="admin-record-list">{cinemas.map((cinema) => <div className="admin-record-row" key={cinema.id}><div><b>{cinema.name}</b><span>{cinema.city} · {cinema.address}</span></div><button className="button button-outline button-small" disabled={busy} onClick={() => void updateCinemaStatus(cinema)}>{cinema.status === "ACTIVE" ? "Đang hoạt động · Tạm dừng" : "Đã tạm dừng · Mở lại"}</button></div>)}</div></section>
      <section className="panel"><div className="panel-title"><span className="eyebrow">AUDITORIUMS</span><h2>Tạo phòng và sơ đồ ghế</h2></div><form className="form-stack admin-create-form" onSubmit={createAuditorium}><label className="field-label">Rạp<select name="cinemaId" required>{cinemas.filter((cinema) => cinema.status === "ACTIVE").map((cinema) => <option key={cinema.id} value={cinema.id}>{cinema.name} · {cinema.city}</option>)}</select></label><div className="form-grid"><label className="field-label">Tên phòng<input name="name" required placeholder="Phòng 03" /></label><label className="field-label">Định dạng<input name="screenType" required defaultValue="STANDARD" /></label></div><div className="form-grid"><label className="field-label">Số hàng<input name="rows" type="number" min={1} max={26} defaultValue={8} required /></label><label className="field-label">Số ghế mỗi hàng<input name="columns" type="number" min={1} max={100} defaultValue={12} required /></label></div><small className="muted">Tạo ghế chuẩn theo nhãn A1, A2… Tối đa 300 ghế mỗi phòng.</small><button className="button button-primary" disabled={busy || !cinemas.some((cinema) => cinema.status === "ACTIVE")}>Tạo phòng</button></form><div className="admin-record-list">{auditoriums.map((room) => <details className="admin-record-detail" key={room.id}><summary><b>{room.cinemaName} · {room.name}</b><span>{room.seatCount} ghế · {room.screenType}</span></summary><form className="form-grid admin-inline-form" data-auditorium-id={room.id} onSubmit={updateAuditorium}><label className="field-label">Tên phòng<input name="name" defaultValue={room.name} required /></label><label className="field-label">Định dạng<input name="screenType" defaultValue={room.screenType} required /></label><button className="button button-outline button-small" disabled={busy}>Lưu thay đổi</button></form><details className="admin-seat-detail"><summary>Quản lý sơ đồ ghế ({room.seatCount ?? room.seats?.length ?? 0})</summary><p className="muted tiny">Đổi hàng/cột hoặc loại ghế. Ghế đang được giữ/đã bán sẽ bị từ chối cập nhật và giữ nguyên lịch sử.</p><div className="admin-seat-list">{room.seats?.map((seat) => <form className="admin-seat-form" data-seat-id={seat.id} data-testid={`admin-seat-edit-form-${seat.id}`} key={seat.id} onSubmit={updateSeat}><label className="field-label">Hàng<input name="row" defaultValue={seat.row} required maxLength={3} pattern="[A-Za-z]{1,3}" title="Tối đa 3 chữ cái" /></label><label className="field-label">Số ghế<input type="number" name="column" defaultValue={seat.column} min={1} max={100} step={1} required /></label><label className="field-label">Loại ghế<select name="type" defaultValue={seat.type}><option value="STANDARD">Thường</option><option value="PREMIUM">VIP</option><option value="ACCESSIBLE">Hỗ trợ tiếp cận</option></select></label><button className="button button-outline button-small" disabled={busy}>Lưu ghế {seat.label}</button></form>)}</div></details></details>)}</div></section>
    </div>
    <section className="panel admin-section"><div className="panel-title"><span className="eyebrow">SHOWTIME CONTROL</span><h2>Giá và trạng thái suất chiếu</h2></div><div className="admin-showtime-list">{adminShowtimes.map((showtime) => <form className="admin-showtime-row" data-showtime-id={showtime.id} key={showtime.id} onSubmit={updateShowtime}><div className="admin-showtime-title"><b>{showtime.movieTitle}</b><span>{showtime.cinemaName} · {showtime.auditoriumName} · {shortDate(showtime.date)} {timeOf(showtime.startAt)}</span></div><label className="field-label">Giá vé<input type="number" name="priceVnd" min={1000} max={1000000} step={1000} defaultValue={showtime.priceVnd} required /></label><label className="field-label">Phụ thu ghế VIP<input type="number" name="premiumSurchargeVnd" min={0} max={500000} step={1000} defaultValue={showtime.premiumSurchargeVnd ?? 30000} required /></label><label className="field-label">Trạng thái<select name="status" defaultValue={showtime.status ?? "ACTIVE"}><option value="ACTIVE">Đang mở bán</option><option value="INACTIVE">Tạm ngừng</option></select></label><button className="button button-outline button-small" disabled={busy}>Cập nhật</button></form>)}{!adminShowtimes.length && <p className="muted">Chưa có suất chiếu để quản lý.</p>}</div></section>
    <section className="panel admin-section admin-users-panel"><div className="panel-title"><span className="eyebrow">ACCOUNT CONTROL</span><h2>Quản lý người dùng</h2><p className="muted">Đổi vai trò và phân công rạp cho Staff. Chỉ tải tối đa 20 tài khoản mỗi lượt.</p></div><div className="admin-user-list">{adminUsers.map((user) => <article className="admin-user-row" data-testid={`admin-user-row-${user.id}`} key={user.id}><div className="admin-user-identity"><b>{user.name}</b><span>{user.email}</span><small>{user.assignedCinema ? `Rạp hiện tại: ${user.assignedCinema.name}` : "Chưa phân công rạp"}</small></div><form className="admin-user-role-form" data-user-id={user.id} onSubmit={updateAdminUserRole}><label className="field-label">Vai trò<select aria-label={`Vai trò của ${user.email}`} name="role" defaultValue={user.role}><option value="CUSTOMER">Khách hàng</option><option value="STAFF">Nhân viên</option><option value="ADMIN">Quản trị</option></select></label><button className="button button-outline button-small" disabled={busy}>Lưu vai trò</button></form>{user.role === "STAFF" && <form className="admin-user-cinema-form" data-user-id={user.id} onSubmit={updateAdminUserCinema}><label className="field-label">Rạp phân công<select aria-label={`Rạp phân công cho ${user.email}`} name="cinemaId" defaultValue={user.assignedCinemaId ?? ""}><option value="">Chưa phân công</option>{cinemas.filter((cinema) => cinema.status === "ACTIVE" || cinema.id === user.assignedCinemaId).map((cinema) => <option key={cinema.id} value={cinema.id} disabled={cinema.status === "INACTIVE"}>{cinema.name}{cinema.status === "INACTIVE" ? " · Tạm dừng" : ""}</option>)}</select></label><button className="button button-outline button-small" disabled={busy}>Lưu rạp</button></form>}</article>)}</div>{usersLoading && <p role="status" className="muted">Đang tải thêm người dùng…</p>}{usersNextCursor && <button className="button button-outline admin-load-more" disabled={busy || usersLoading} onClick={() => void loadMoreAdminUsers()}>{usersLoading ? "Đang tải…" : "Tải thêm người dùng"}</button>}</section>
  </div>;
}

function ScanPanel({ session }: { session: Session }) {
  const [qrToken, setQrToken] = useState(""); const [result, setResult] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function scan(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); setResult(""); try { const response = await api.scanQr(session.token, qrToken.trim()); setResult(`Vé hợp lệ · ${response.movieTitle} · Ghế ${response.seat}. Đã ghi nhận lúc ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(response.checkedInAt))}.`); setQrToken(""); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } }
  return <div className="scan-wrap"><section className="panel scan-panel"><span className="eyebrow">GATE CHECK</span><h1>Soát vé tại cửa</h1><p className="muted">Quét QR hoặc dán nội dung mã QR để kiểm tra vé và ghi nhận lượt vào.</p><form className="form-stack" onSubmit={scan}><label className="field-label">Mã QR vé<input aria-label="Mã QR vé" value={qrToken} onChange={(event) => setQrToken(event.target.value)} placeholder="Dán nội dung QR vé" required /></label><button className="button button-primary button-wide" disabled={busy}>{busy ? "Đang kiểm tra…" : "Xác nhận vào rạp"}</button></form>{result && <p role="status" className="alert alert-success">{result}</p>}{error && <p role="alert" className="alert alert-error">{error}</p>}</section></div>;
}

export default function App() {
  const [movies, setMovies] = useState<Movie[]>([]); const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [session, setSession] = useState<Session | null>(() => readSession()); const [view, setView] = useState<View>("discover");
  const [date, setDate] = useState(businessDateOffset(1)); const [cinemaId, setCinemaId] = useState(""); const [activeMovieId, setActiveMovieId] = useState("");
  const [loading, setLoading] = useState(true); const [scheduleLoading, setScheduleLoading] = useState(false); const [error, setError] = useState("");
  const [seatShowtime, setSeatShowtime] = useState<Showtime | null>(null); const [authMode, setAuthMode] = useState<AuthMode>("login"); const [authOpen, setAuthOpen] = useState(false);
  const [queuedSelection, setQueuedSelection] = useState<{ showtimeId: string; seatIds: string[] } | null>(null);
  const [hold, setHold] = useState<Hold | null>(null); const [holdMap, setHoldMap] = useState<SeatMap | null>(null); const [secondsLeft, setSecondsLeft] = useState(0);
  const [bookingStep, setBookingStep] = useState<BookingStep>("seats"); const [order, setOrder] = useState<Order | null>(null); const [paidTickets, setPaidTickets] = useState<Ticket[]>([]);
  const [orders, setOrders] = useState<Order[]>([]); const [ordersNextCursor, setOrdersNextCursor] = useState<string | null>(null); const [ordersLoading, setOrdersLoading] = useState(false); const [checkoutBusy, setCheckoutBusy] = useState(false);
  const checkoutDialogRef = useRef<HTMLElement | null>(null);
  const scheduleHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const ticketsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusTicketsAfterCheckoutRef = useRef(false);
  const checkoutActionFocusRef = useRef<HTMLElement | null>(null);
  const seatShowtimeOpenerRef = useRef<HTMLElement | null>(null);
  const discoverNavRef = useRef<HTMLButtonElement | null>(null);
  const signInButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileAccountRef = useRef<HTMLButtonElement | null>(null);
  const loginFocusReturnRef = useRef<HTMLElement | null>(null);
  const focusSignInAfterLogoutRef = useRef(false);
  const cinemas = useMemo(() => [...new Map(showtimes.map((showtime) => [showtime.cinemaId, showtime.cinemaName])).entries()].map(([id, name]) => ({ id, name })), [showtimes]);
  const activeMovie = movies.find((movie) => movie.id === activeMovieId) || movies[0];
  const activeShowtimes = showtimes.filter((item) => item.movieId === activeMovie?.id);

  useEffect(() => {
    if (session || !focusSignInAfterLogoutRef.current) return;
    focusSignInAfterLogoutRef.current = false;
    const visibleHeaderControl = [signInButtonRef.current, mobileAccountRef.current]
      .find((element) => element?.getClientRects().length);
    visibleHeaderControl?.focus();
  }, [session]);

  useEffect(() => {
    if (view !== "tickets" || !focusTicketsAfterCheckoutRef.current) return;
    focusTicketsAfterCheckoutRef.current = false;
    ticketsHeadingRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (!hold || checkoutBusy || !checkoutActionFocusRef.current) return;
    const dialog = checkoutDialogRef.current;
    const previousAction = checkoutActionFocusRef.current;
    checkoutActionFocusRef.current = null;
    // Disabling or replacing the action can lose focus or leave it on the old
    // control in different browsers. Do not override a user's later movement.
    if (dialog && (document.activeElement === document.body || document.activeElement === previousAction)) {
      dialog.querySelector<HTMLElement>('[data-testid="pay-submit"], [data-testid="checkout-submit"], .success-content button')?.focus();
    }
  }, [hold?.id, order?.id, bookingStep, checkoutBusy]);

  useEffect(() => { let alive = true; api.movies().then((items) => { if (!alive) return; setMovies(items); setActiveMovieId(items[0]?.id || ""); }).catch((reason) => { if (alive) setError(humanError(reason)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    let alive = true; setScheduleLoading(true);
    api.showtimes({ date, cinemaId: cinemaId || undefined }).then((items) => { if (alive) { setShowtimes(items); if (cinemaId && !items.some((item) => item.cinemaId === cinemaId)) setCinemaId(""); } }).catch((reason) => { if (alive) setError(humanError(reason)); }).finally(() => { if (alive) setScheduleLoading(false); });
    return () => { alive = false; };
  }, [date, cinemaId]);
  useEffect(() => {
    if (!hold) { setSecondsLeft(0); return; }
    if (bookingStep === "success") return;
    const tick = () => { const left = Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)); setSecondsLeft(left); if (left === 0) { setHold(null); setHoldMap(null); setOrder(null); setBookingStep("seats"); setError("Thời gian giữ ghế đã hết. Ghế được trả lại để người khác đặt."); } };
    tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer);
  }, [hold?.id, hold?.expiresAt, bookingStep]);

  function saveSession(value: Session) {
    const queued = queuedSelection;
    loginFocusReturnRef.current = queued ? null : discoverNavRef.current;
    localStorage.setItem(SESSION_KEY, JSON.stringify(value)); setSession(value); setAuthOpen(false);
    if (queued) { setQueuedSelection(null); void reserveSelection(queued.showtimeId, queued.seatIds, value); }
  }
  function openLogin(opener?: HTMLElement) { loginFocusReturnRef.current = opener || null; setAuthMode("login"); setAuthOpen(true); }
  async function reserveSelection(showtimeId: string, seatIds: string[], currentSession = session) {
    if (!currentSession) { setQueuedSelection({ showtimeId, seatIds }); setAuthMode("login"); setAuthOpen(true); return; }
    try { const [createdHold, map] = await Promise.all([api.createHold(currentSession.token, showtimeId, seatIds), api.seats(showtimeId)]); setHold(createdHold); setHoldMap(map); setBookingStep("checkout"); setError(""); setOrder(null); setPaidTickets([]); setSeatShowtime(null); }
    catch (reason) { setError(humanError(reason)); if (reason instanceof ApiError && reason.status === 409) { setSeatShowtime(showtimes.find((item) => item.id === showtimeId) || null); } }
  }
  async function continueCheckout() {
    if (!hold || !session) return;
    checkoutActionFocusRef.current = document.activeElement === checkoutDialogRef.current?.querySelector('[data-testid="checkout-submit"]') ? document.activeElement as HTMLElement : null;
    setCheckoutBusy(true); setError("");
    try { const value = await api.createOrder(session.token, hold.id); setOrder(value); setBookingStep("checkout"); }
    catch (reason) { setError(humanError(reason)); }
    finally { setCheckoutBusy(false); }
  }
  async function payDemo() {
    if (!order || !session) return;
    checkoutActionFocusRef.current = document.activeElement === checkoutDialogRef.current?.querySelector('[data-testid="pay-submit"]') ? document.activeElement as HTMLElement : null;
    setCheckoutBusy(true); setError("");
    try {
      const result = await api.payDemo(session.token, order.id);
      setPaidTickets(result.tickets);
      setBookingStep("success");
      try { const page = await api.orders(session.token); setOrders(page.items); setOrdersNextCursor(page.nextCursor); }
      catch { /* Payment is already confirmed; the success response contains the tickets. */ }
    }
    catch (reason) {
      setError(reason instanceof ApiError
        ? humanError(reason)
        : "Không nhận được phản hồi thanh toán. Giao dịch có thể đã được ghi nhận; hãy thử lại để kiểm tra trạng thái.");
    }
    finally { setCheckoutBusy(false); }
  }
  function closeCheckout() {
    if (bookingStep === "success") return;
    setHold(null); setHoldMap(null); setOrder(null); setBookingStep("seats");
  }
  async function loadOrders() {
    if (!session) { openLogin(); return; }
    setView("tickets"); setOrdersLoading(true); setError("");
    try { const page = await api.orders(session.token); setOrders(page.items); setOrdersNextCursor(page.nextCursor); } catch (reason) { setError(humanError(reason)); }
    finally { setOrdersLoading(false); }
  }
  async function loadMoreOrders() {
    if (!session || !ordersNextCursor || ordersLoading) return;
    setOrdersLoading(true); setError("");
    try { const page = await api.orders(session.token, ordersNextCursor); setOrders((current) => [...current, ...page.items]); setOrdersNextCursor(page.nextCursor); }
    catch (reason) { setError(humanError(reason)); }
    finally { setOrdersLoading(false); }
  }
  function logout() { loginFocusReturnRef.current = null; focusSignInAfterLogoutRef.current = true; localStorage.removeItem(SESSION_KEY); setSession(null); setView("discover"); setOrders([]); setOrdersNextCursor(null); }
  const featured = movies[0];

  return <div className="app-shell">
    <header className="topbar"><a href="#top" className="brand" onClick={() => setView("discover")}><span className="brand-icon" aria-hidden="true">C</span><span>Cinema<span className="brand-light">Booking</span></span></a>
      <nav className="main-nav" aria-label="Điều hướng chính"><button ref={discoverNavRef} className={view === "discover" ? "nav-link active" : "nav-link"} onClick={() => setView("discover")}>Khám phá</button>{session && <button className={view === "tickets" ? "nav-link active" : "nav-link"} onClick={() => void loadOrders()}>Vé của tôi</button>}{session && (session.user.role === "STAFF" || session.user.role === "ADMIN") && <button className={view === "scan" ? "nav-link active" : "nav-link"} onClick={() => setView("scan")}>Soát vé</button>}{session?.user.role === "ADMIN" && <button className={view === "admin" ? "nav-link active" : "nav-link"} onClick={() => setView("admin")}>Quản trị</button>}</nav>
    <div className="header-actions">{session ? <><span className="user-greeting">Xin chào, {session.user.name.split(" ").at(-1)}</span><span aria-hidden="true" className="avatar-button" style={{ cursor: "default" }}>{initials(session.user.name)}</span><button className="button button-outline sign-button" onClick={logout}>Đăng xuất</button><button aria-label="Đăng xuất" title="Đăng xuất" className="mobile-logout" onClick={logout}>↪</button></> : <button ref={signInButtonRef} className="button button-outline sign-button" onClick={(event) => openLogin(event.currentTarget)}>Đăng nhập</button>}<button ref={mobileAccountRef} aria-label={session ? `Mở tài khoản ${initials(session.user.name)}` : "Mở tài khoản"} className="mobile-account" onClick={(event) => session ? void loadOrders() : openLogin(event.currentTarget)}>{session ? initials(session.user.name) : "↗"}</button></div>
    </header>

    {view === "discover" && <main id="top">
      {featured && <section className="hero"><div className="hero-backdrop" aria-hidden="true" /><div className="hero-content"><span className="eyebrow"><i className="live-dot" /> TRẢI NGHIỆM ĐIỆN ẢNH</span><h1>Chọn phim hay.<br /><em>Giữ chỗ đẹp.</em></h1><p>Đêm nay dành cho những câu chuyện xứng đáng được xem trên màn ảnh lớn.</p><div className="hero-actions"><button className="button button-primary" onClick={() => { setActiveMovieId(featured.id); document.getElementById("movies")?.scrollIntoView({ behavior: "smooth" }); }}>Khám phá phim <span aria-hidden="true">↓</span></button><span className="hero-note">Đặt vé trong vài bước đơn giản</span></div></div><div className="hero-poster-wrap"><Poster movie={featured} large /><div className="hero-poster-caption"><span>ĐANG ĐƯỢC QUAN TÂM</span><b>{featured.title}</b></div></div><div className="hero-vertical">CINEMA · 01 / 05</div></section>}
      <section className="movie-section" id="movies"><div className="section-heading"><div><span className="eyebrow">ĐANG CHIẾU TẠI RẠP</span><h2>Chọn câu chuyện của bạn</h2><p className="muted">Những bộ phim đang được khán giả yêu thích.</p></div><div className="section-decoration" aria-hidden="true">✳</div></div>
        {error && bookingStep === "seats" && <p role="alert" className="alert alert-error">{error}<button className="text-button" onClick={() => setError("")}>Đóng</button></p>}
        {loading ? <div className="loading-grid">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton-card" />)}</div> : movies.length ? <div className="movie-rail">{movies.map((movie, index) => <article className={`movie-card ${movie.id === activeMovie?.id ? "movie-card-active" : ""}`} key={movie.id} data-testid="movie-card"><button className="movie-poster-button" onClick={() => setActiveMovieId(movie.id)}><Poster movie={movie} /><span className="movie-index">{String(index + 1).padStart(2, "0")}</span></button><div className="movie-info"><div className="movie-tags"><span className="rating-tag">{movie.ageRating || "P"}</span><span>{movie.genre}</span><span>{movie.runtimeMinutes} phút</span></div><h3>{movie.title}</h3><p>{movie.synopsis}</p><button className="text-button movie-select" onClick={() => { setActiveMovieId(movie.id); scheduleHeadingRef.current?.focus({ preventScroll: true }); document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth" }); }}>Xem suất chiếu <span aria-hidden="true">→</span></button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon">✳</span><h3>Phim hay đang chuẩn bị lên sóng</h3><p>Hiện chưa có phim trong danh mục. Bạn có thể thử tải lại sau ít phút.</p></div>}
      </section>

      <section className="schedule-section" id="schedule"><div className="section-heading"><div><span className="eyebrow">LỊCH CHIẾU</span><h2 ref={scheduleHeadingRef} tabIndex={-1}>{activeMovie ? `Suất chiếu · ${activeMovie.title}` : "Suất chiếu hôm nay"}</h2><p className="muted">Chọn rạp và ngày phù hợp với lịch của bạn.</p></div></div>
        <div className="schedule-filters"><label className="filter-field"><span>Ngày xem phim</span><select value={date} onChange={(event) => setDate(event.target.value)}>{Array.from({ length: 7 }, (_, index) => { const value = businessDateOffset(index + 1); return <option key={value} value={value}>{shortDate(value)}</option>; })}</select></label><label className="filter-field"><span>Rạp chiếu</span><select value={cinemaId} onChange={(event) => setCinemaId(event.target.value)}><option value="">Tất cả rạp</option>{cinemas.map((cinema) => <option value={cinema.id} key={cinema.id}>{cinema.name}</option>)}</select></label><div className="showtime-legend"><span><i className="live-dot" /> Suất còn chỗ</span><span className="muted">Giá từ {formatVnd(activeShowtimes.length ? Math.min(...activeShowtimes.map((showtime) => showtime.priceVnd)) : 0)}</span></div></div>
        <p className="sr-only" role="status" aria-atomic="true">{scheduleLoading ? "Đang tìm suất chiếu." : activeShowtimes.length ? `${activeShowtimes.length} suất chiếu phù hợp${activeMovie ? ` cho ${activeMovie.title}` : ""}.` : "Không có suất chiếu phù hợp. Hãy thử ngày hoặc rạp khác."}</p>
        {scheduleLoading ? <div className="schedule-loading"><span className="spinner" />Đang tìm suất chiếu…</div> : !activeShowtimes.length ? <div className="empty-inline"><span>✳</span><div><b>Ngày này chưa có suất chiếu phù hợp</b><p>Hãy thử một ngày khác hoặc đổi rạp nhé.</p></div></div> : <div className="showtime-list">{activeShowtimes.map((showtime) => <article className="showtime-card" key={showtime.id}><div className="showtime-venue"><span className="venue-icon">⌂</span><div><b>{showtime.cinemaName}</b><span>{showtime.auditoriumName}{showtime.screenType ? ` · ${showtime.screenType}` : ""}</span></div></div><div className="showtime-time"><b>{timeOf(showtime.startAt)}</b><span>{shortDate(showtime.date)}</span></div><div className="showtime-price"><span>Vé từ</span><b>{formatVnd(showtime.priceVnd)}</b></div><button data-testid="showtime-option" className="button button-primary showtime-button" onClick={(event) => { seatShowtimeOpenerRef.current = event.currentTarget; setSeatShowtime(showtime); }}>Chọn suất <span aria-hidden="true">→</span></button></article>)}</div>}
      </section>
      <section className="promise-strip"><div><span>01</span><b>Chọn chỗ dễ dàng</b><small>Sơ đồ ghế trực quan</small></div><div><span>02</span><b>Thanh toán an tâm</b><small>Giao dịch bảo mật</small></div><div><span>03</span><b>Vé về tay ngay</b><small>QR sẵn sàng vào rạp</small></div></section>
    </main>}

    {view === "tickets" && <main className="content-page"><div className="section-heading"><div><span className="eyebrow">CINEMA CLUB</span><h1 ref={ticketsHeadingRef} tabIndex={-1}>Vé của bạn</h1><p className="muted">Lưu lại những buổi tối đáng nhớ.</p></div><button className="button button-outline" onClick={() => void loadOrders()}>↻ Cập nhật vé</button></div>{ordersLoading && <p role="status" aria-live="polite" className="sr-only">{orders.length ? "Đang cập nhật danh sách vé." : "Đang tải vé của bạn."}</p>}{error && <p role="alert" className="alert alert-error">{error}</p>}{ordersLoading && !orders.length ? <div className="schedule-loading" aria-hidden="true"><span className="spinner" />Đang tải vé…</div> : orders.length ? <><div className="ticket-list">{orders.map((item) => <TicketCard order={item} key={item.id} />)}</div>{ordersNextCursor && <button className="button button-outline admin-load-more" disabled={ordersLoading} onClick={() => void loadMoreOrders()}>{ordersLoading ? "Đang tải…" : "Tải thêm vé"}</button>}</> : error ? null : <div className="empty-state"><span className="empty-icon">▱</span><h3>Chưa có chiếc vé nào</h3><p>Chọn một bộ phim và giữ chỗ để bắt đầu hành trình.</p><button className="button button-primary" onClick={() => setView("discover")}>Khám phá phim</button></div>}</main>}
    {view === "scan" && session && <main className="content-page"><ScanPanel session={session} /></main>}
    {view === "admin" && session?.user.role === "ADMIN" && <main className="content-page"><AdminPanel session={session} /></main>}

    <footer className="footer"><a href="#top" className="brand"><span className="brand-icon" aria-hidden="true">C</span><span>Cinema<span className="brand-light">Booking</span></span></a><p>Thêm một chút cảm xúc vào lịch trình của bạn.</p><span>© 2026 CINEMA BOOKING · VÉ DEMO</span></footer>

    {seatShowtime && <SeatDialog showtime={seatShowtime} session={session} isTopModal={!authOpen} restoreFocusFallback={seatShowtimeOpenerRef} onClose={() => setSeatShowtime(null)} onRequireAuth={(showtimeId, seatIds) => { loginFocusReturnRef.current = null; setQueuedSelection({ showtimeId, seatIds }); setAuthMode("login"); setAuthOpen(true); }} onHoldCreated={(created, map) => { setSecondsLeft(Math.max(0, Math.ceil((new Date(created.expiresAt).getTime() - Date.now()) / 1000))); setHold(created); setHoldMap(map); setBookingStep("checkout"); setSeatShowtime(null); setError(""); }} />}
    {authOpen && <AuthDialog mode={authMode} setMode={setAuthMode} restoreFocusFallback={loginFocusReturnRef} onClose={() => { setAuthOpen(false); setQueuedSelection(null); }} onSuccess={saveSession} />}

    {hold && <div className="overlay booking-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && bookingStep !== "success") return; }}>
      <section ref={checkoutDialogRef} className="dialog checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title" tabIndex={-1}>
        <ModalKeyboardSupport dialogRef={checkoutDialogRef} onEscape={bookingStep !== "success" ? closeCheckout : undefined} restoreFocusFallback={seatShowtimeOpenerRef} />
        <div className="dialog-top"><div><span className="eyebrow">{bookingStep === "success" ? "VÉ ĐÃ SẴN SÀNG" : "HOÀN TẤT ĐẶT VÉ"}</span><h2 id="checkout-title">{bookingStep === "success" ? "Hẹn gặp bạn tại rạp." : "Một bước nữa thôi."}</h2></div>{bookingStep !== "success" && <button className="icon-button" aria-label="Đóng" onClick={closeCheckout}>×</button>}</div>
        {bookingStep === "success" ? <div className="success-content"><div className="success-check">✓</div><p>Thanh toán demo thành công. Vé điện tử đã được gửi vào mục <b>Vé của tôi</b>.</p><div className="success-tickets">{paidTickets.map((ticket) => <div className="mini-ticket" key={ticket.id}><QRCodeSVG value={ticket.qrToken} title={`Mã QR vé ${ticket.id.slice(-8).toUpperCase()}`} size={92} /><span>THAM CHIẾU · {ticket.id.slice(-8).toUpperCase()}</span></div>)}</div><button className="button button-primary button-wide" onClick={() => { setHold(null); setHoldMap(null); setBookingStep("seats"); focusTicketsAfterCheckoutRef.current = true; void loadOrders(); }}>Xem vé của tôi</button></div> : <>
          <p className="sr-only" role="status" data-testid="hold-created-announcement">Ghế đang được giữ. Vui lòng hoàn tất thanh toán trước khi hết giờ.</p>
          <div className="hold-countdown" data-testid="hold-countdown" role="timer" aria-live="off" aria-label={`Thời gian giữ ghế còn lại ${String(Math.floor(secondsLeft / 60)).padStart(2, "0")} phút ${String(secondsLeft % 60).padStart(2, "0")} giây`}><span className="timer-icon" aria-hidden="true">◷</span><div><span>GHẾ ĐANG ĐƯỢC GIỮ CHO BẠN</span><b>{String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:{String(secondsLeft % 60).padStart(2, "0")}</b></div><small>Vui lòng hoàn tất trước khi hết giờ.</small></div>
          <div className="checkout-summary"><div className="checkout-movie"><Poster movie={movies.find((item) => item.id === holdMap?.showtime.movieId) || { id: "ticket", title: holdMap?.showtime.movieTitle || "Cinema", genre: "Điện ảnh", synopsis: "", runtimeMinutes: 0, ageRating: "P" }} /><div><b>{holdMap?.showtime.movieTitle || "Phim đang chọn"}</b><span>{holdMap?.showtime.cinemaName} · {holdMap?.showtime.auditoriumName}</span><span>{holdMap?.showtime.date ? shortDate(holdMap.showtime.date) : ""} · {holdMap?.showtime.startAt ? timeOf(holdMap.showtime.startAt) : ""}</span><span>Ghế: {holdMap?.seats.filter((seat) => hold.seatIds.includes(seat.id)).map((seat) => seat.label).join(", ")}</span></div></div><div className="summary-line"><span>Tạm tính ({hold.seatIds.length} vé)</span><b>{formatVnd(hold.totalVnd)}</b></div><div className="summary-line summary-total"><span>Tổng thanh toán</span><b>{formatVnd(order?.totalVnd ?? hold.totalVnd)}</b></div></div>
          {error && <p role="alert" className="alert alert-error">{error}</p>}
          {!order ? <button data-testid="checkout-submit" className="button button-primary button-wide" onClick={() => void continueCheckout()} disabled={checkoutBusy || secondsLeft <= 0}>{checkoutBusy ? "Đang tạo đơn…" : "Tiếp tục thanh toán"}<span aria-hidden="true">→</span></button> : <><div className="payment-demo"><span className="payment-mark">C</span><div><b>Thanh toán mô phỏng</b><small>Không phát sinh giao dịch thật.</small></div><span className="payment-lock">▣</span></div><button data-testid="pay-submit" className="button button-primary button-wide" onClick={() => void payDemo()} disabled={checkoutBusy || secondsLeft <= 0}>{checkoutBusy ? "Đang xác nhận…" : `Thanh toán ${formatVnd(order.totalVnd)}`}</button></>}
          <p className="secure-note">⌑ Thông tin giao dịch demo được xử lý an toàn trong hệ thống.</p>
        </>}
      </section>
    </div>}
  </div>;
}
