-- Migration 010: unique indexes per clienti (previene duplicati)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone ON clients (salon_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_treatwell ON clients (salon_id, treatwell_client_id) WHERE treatwell_client_id IS NOT NULL;
