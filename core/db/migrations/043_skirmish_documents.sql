CREATE TABLE cvc.skirmish_documents (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data BYTEA NOT NULL,
    raw_text TEXT,
    source_label TEXT,
    parsed BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_skirmish_documents_uploaded_at ON cvc.skirmish_documents(uploaded_at DESC);
