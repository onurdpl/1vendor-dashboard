CREATE TYPE "PayoutPreparationFailureStatus" AS ENUM ('OPEN', 'RESOLVED');

ALTER TABLE "PayoutPreparationFailure"
ADD COLUMN "status" "PayoutPreparationFailureStatus" NOT NULL DEFAULT 'OPEN';

CREATE TABLE "PayoutPreparationFailureResolution" (
    "failureId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL CHECK (btrim("actorId") <> ''),
    "reason" VARCHAR(500) NOT NULL CHECK (btrim("reason") <> ''),
    "resolvedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PayoutPreparationFailureResolution_pkey" PRIMARY KEY ("failureId"),
    CONSTRAINT "PayoutPreparationFailureResolution_failureId_fkey"
        FOREIGN KEY ("failureId") REFERENCES "PayoutPreparationFailure"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION payout_failure_resolution_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Payout preparation failure resolution evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payout_failure_resolution_immutable_trigger
BEFORE UPDATE OR DELETE ON "PayoutPreparationFailureResolution"
FOR EACH ROW EXECUTE FUNCTION payout_failure_resolution_immutable();
