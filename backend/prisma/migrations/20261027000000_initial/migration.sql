-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('STANDARD', 'PREMIUM', 'ACCESSIBLE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('HELD', 'SOLD', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PAYMENT_PENDING', 'CONFIRMED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cinema" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cinema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditorium" (
    "id" TEXT NOT NULL,
    "cinemaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "screenType" TEXT NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "Auditorium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "auditoriumId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "column" INTEGER NOT NULL,
    "type" "SeatType" NOT NULL DEFAULT 'STANDARD',
    "isAccessible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movie" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "runtimeMinutes" INTEGER NOT NULL,
    "ageRating" TEXT NOT NULL,
    "posterUrl" TEXT,
    "releaseDate" TIMESTAMP(3),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Showtime" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "auditoriumId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "priceVnd" INTEGER NOT NULL,
    "premiumSurchargeVnd" INTEGER NOT NULL DEFAULT 30000,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Showtime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showtimeId" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CinemaOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showtimeId" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "totalVnd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CinemaOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatClaim" (
    "id" TEXT NOT NULL,
    "showtimeId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "holdId" TEXT,
    "orderId" TEXT,
    "status" "ClaimStatus" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "priceVnd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeatClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "providerEventId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountVnd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "payloadHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "seatClaimId" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Auditorium_cinemaId_name_key" ON "Auditorium"("cinemaId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_auditoriumId_label_key" ON "Seat"("auditoriumId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_auditoriumId_row_column_key" ON "Seat"("auditoriumId", "row", "column");

-- CreateIndex
CREATE UNIQUE INDEX "Movie_slug_key" ON "Movie"("slug");

-- CreateIndex
CREATE INDEX "Showtime_movieId_startAt_idx" ON "Showtime"("movieId", "startAt");

-- CreateIndex
CREATE INDEX "Showtime_auditoriumId_startAt_endAt_idx" ON "Showtime"("auditoriumId", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "Showtime_auditoriumId_startAt_key" ON "Showtime"("auditoriumId", "startAt");

-- CreateIndex
CREATE INDEX "SeatHold_userId_createdAt_idx" ON "SeatHold"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SeatHold_status_expiresAt_idx" ON "SeatHold"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CinemaOrder_holdId_key" ON "CinemaOrder"("holdId");

-- CreateIndex
CREATE INDEX "CinemaOrder_userId_createdAt_idx" ON "CinemaOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SeatClaim_holdId_idx" ON "SeatClaim"("holdId");

-- CreateIndex
CREATE INDEX "SeatClaim_orderId_idx" ON "SeatClaim"("orderId");

-- CreateIndex
CREATE INDEX "SeatClaim_status_expiresAt_idx" ON "SeatClaim"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeatClaim_showtimeId_seatId_key" ON "SeatClaim"("showtimeId", "seatId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerEventId_key" ON "Payment"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_seatClaimId_key" ON "Ticket"("seatClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_qrToken_key" ON "Ticket"("qrToken");

-- CreateIndex
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Auditorium" ADD CONSTRAINT "Auditorium_cinemaId_fkey" FOREIGN KEY ("cinemaId") REFERENCES "Cinema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_auditoriumId_fkey" FOREIGN KEY ("auditoriumId") REFERENCES "Auditorium"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showtime" ADD CONSTRAINT "Showtime_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showtime" ADD CONSTRAINT "Showtime_auditoriumId_fkey" FOREIGN KEY ("auditoriumId") REFERENCES "Auditorium"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "Showtime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CinemaOrder" ADD CONSTRAINT "CinemaOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CinemaOrder" ADD CONSTRAINT "CinemaOrder_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "Showtime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CinemaOrder" ADD CONSTRAINT "CinemaOrder_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "SeatHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatClaim" ADD CONSTRAINT "SeatClaim_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "Showtime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatClaim" ADD CONSTRAINT "SeatClaim_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatClaim" ADD CONSTRAINT "SeatClaim_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "SeatHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatClaim" ADD CONSTRAINT "SeatClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CinemaOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CinemaOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Payment"("orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CinemaOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_seatClaimId_fkey" FOREIGN KEY ("seatClaimId") REFERENCES "SeatClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
