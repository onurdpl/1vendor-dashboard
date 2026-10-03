CREATE TABLE "SopyoVendorCredential" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopyoVendorCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SopyoVendorCredential_vendorId_key" ON "SopyoVendorCredential"("vendorId");

ALTER TABLE "SopyoVendorCredential" ADD CONSTRAINT "SopyoVendorCredential_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
