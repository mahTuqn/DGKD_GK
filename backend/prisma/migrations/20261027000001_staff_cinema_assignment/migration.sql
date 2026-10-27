-- Track the cinema to which a staff account is assigned. Customers and admins
-- may keep this nullable; the API enforces assignments for staff check-in.
ALTER TABLE "User" ADD COLUMN "assignedCinemaId" TEXT;

CREATE INDEX "User_assignedCinemaId_idx" ON "User"("assignedCinemaId");

ALTER TABLE "User"
ADD CONSTRAINT "User_assignedCinemaId_fkey"
FOREIGN KEY ("assignedCinemaId") REFERENCES "Cinema"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
