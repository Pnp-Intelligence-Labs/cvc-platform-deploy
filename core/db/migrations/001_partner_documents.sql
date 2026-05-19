CREATE TABLE IF NOT EXISTS cvc.partner_documents (
    id SERIAL PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL CHECK (file_type IN ('PDF', 'DOCX', 'TXT')),
    file_data BYTEA NOT NULL,
    file_size INTEGER,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_partner_documents_partner_id ON cvc.partner_documents(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_documents_uploaded_at ON cvc.partner_documents(uploaded_at DESC);
