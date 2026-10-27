import "dotenv/config";
import { PrismaClient, RecordStatus, Role, SeatType } from "@prisma/client";
import { hashPassword } from "../src/auth.js";
import { calendarDateAtTime, getBusinessDate } from "../src/domain/booking-policy.js";

const prisma = new PrismaClient();

function tomorrowBusinessDate() {
  const [year, month, day] = getBusinessDate().split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return tomorrow.toISOString().slice(0, 10);
}

async function main() {
  const accounts = [
    { name: "Demo Customer", email: "customer@cinema.local", password: "CinemaCustomer123!", role: Role.CUSTOMER },
    { name: "Demo Staff", email: "staff@cinema.local", password: "CinemaStaff123!", role: Role.STAFF },
    { name: "Demo Administrator", email: "admin@cinema.local", password: "CinemaAdmin123!", role: Role.ADMIN }
  ];
  for (const account of accounts) {
    const passwordHash = await hashPassword(account.password);
    await prisma.user.upsert({
      where: { email: account.email },
      create: { name: account.name, email: account.email, passwordHash, role: account.role },
      update: { name: account.name, passwordHash, role: account.role }
    });
  }

  const cinema = await prisma.cinema.upsert({
    where: { id: "cinema-demo-hcmc" },
    create: { id: "cinema-demo-hcmc", name: "Cinema Saigon Center", city: "Thành phố Hồ Chí Minh", address: "123 Đường Demo, Quận 1" },
    update: { name: "Cinema Saigon Center", city: "Thành phố Hồ Chí Minh", address: "123 Đường Demo, Quận 1", status: RecordStatus.ACTIVE }
  });
  await prisma.user.update({ where: { email: "staff@cinema.local" }, data: { assignedCinemaId: cinema.id } });
  await prisma.user.update({ where: { email: "customer@cinema.local" }, data: { assignedCinemaId: null } });
  await prisma.user.update({ where: { email: "admin@cinema.local" }, data: { assignedCinemaId: null } });
  const auditoriumSpecs = [
    { id: "auditorium-demo-1", name: "Phòng 1", screenType: "IMAX" },
    { id: "auditorium-demo-2", name: "Phòng 2", screenType: "STANDARD" }
  ];
  const auditoriums = [];
  for (const spec of auditoriumSpecs) {
    const auditorium = await prisma.auditorium.upsert({
      where: { id: spec.id },
      create: { ...spec, cinemaId: cinema.id },
      update: { ...spec, cinemaId: cinema.id }
    });
    auditoriums.push(auditorium);
    for (const row of ["A", "B", "C", "D", "E", "F"]) {
      for (let column = 1; column <= 8; column++) {
        const label = `${row}${column}`;
        const isAccessible = row === "F" && (column === 1 || column === 8);
        const type = isAccessible ? SeatType.ACCESSIBLE : ["A", "B"].includes(row) ? SeatType.PREMIUM : SeatType.STANDARD;
        await prisma.seat.upsert({
          where: { auditoriumId_label: { auditoriumId: auditorium.id, label } },
          create: { auditoriumId: auditorium.id, label, row, column, type, isAccessible },
          update: { row, column, type, isAccessible }
        });
      }
    }
  }

  const movies = [
    { id: "movie-moonlit-journey", slug: "hanh-trinh-anh-trang", title: "Hành Trình Ánh Trăng", genre: "Phiêu lưu", synopsis: "Một hành trình kỳ ảo đưa hai người bạn qua những miền đất chưa từng được ghi trên bản đồ.", runtimeMinutes: 110, ageRating: "P", posterUrl: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=600&q=80" },
    { id: "movie-summer-memory", slug: "ky-uc-mua-ha", title: "Ký Ức Mùa Hạ", genre: "Tâm lý", synopsis: "Một lá thư cũ đưa Linh trở về thị trấn ven biển và những quyết định của tuổi trẻ.", runtimeMinutes: 105, ageRating: "T13", posterUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80" },
    { id: "movie-midnight-city", slug: "thanh-pho-luc-nua-dem", title: "Thành Phố Lúc Nửa Đêm", genre: "Hành động", synopsis: "Trong một đêm mất điện, một tài xế phải giải mã tín hiệu trước khi thành phố thức dậy.", runtimeMinutes: 125, ageRating: "T16", posterUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=600&q=80" }
  ];
  for (const movie of movies) {
    await prisma.movie.upsert({ where: { slug: movie.slug }, create: movie, update: { ...movie, status: RecordStatus.ACTIVE } });
  }

  const nextDate = tomorrowBusinessDate();
  const showtimeSpecs = [
    { slug: "hanh-trinh-anh-trang", auditoriumId: auditoriums[0]!.id, hour: 14, minute: 0, priceVnd: 95000, premiumSurchargeVnd: 30000 },
    { slug: "ky-uc-mua-ha", auditoriumId: auditoriums[1]!.id, hour: 14, minute: 30, priceVnd: 90000, premiumSurchargeVnd: 25000 },
    { slug: "thanh-pho-luc-nua-dem", auditoriumId: auditoriums[0]!.id, hour: 19, minute: 0, priceVnd: 110000, premiumSurchargeVnd: 35000 },
    { slug: "hanh-trinh-anh-trang", auditoriumId: auditoriums[1]!.id, hour: 19, minute: 30, priceVnd: 105000, premiumSurchargeVnd: 30000 }
  ];
  for (const spec of showtimeSpecs) {
    const movie = movies.find((item) => item.slug === spec.slug)!;
    const startAt = calendarDateAtTime(nextDate, spec.hour, spec.minute);
    const endAt = new Date(startAt.getTime() + movie.runtimeMinutes * 60_000);
    await prisma.showtime.upsert({
      where: { auditoriumId_startAt: { auditoriumId: spec.auditoriumId, startAt } },
      create: { movieId: movie.id, auditoriumId: spec.auditoriumId, startAt, endAt, priceVnd: spec.priceVnd, premiumSurchargeVnd: spec.premiumSurchargeVnd },
      update: { movieId: movie.id, endAt, priceVnd: spec.priceVnd, premiumSurchargeVnd: spec.premiumSurchargeVnd, status: RecordStatus.ACTIVE }
    });
  }
  console.info(`Seeded demo accounts, ${movies.length} movies, ${auditoriums.length} auditoriums, and showtimes for ${nextDate}.`);
}

main().catch((error: unknown) => {
  console.error("Seed failed", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
