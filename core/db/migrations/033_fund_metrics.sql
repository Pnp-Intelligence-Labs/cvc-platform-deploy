CREATE TABLE cvc.fund_metrics (
    id SERIAL PRIMARY KEY,
    committed_capital NUMERIC(15,2) NOT NULL,
    deployed_capital NUMERIC(15,2) NOT NULL,
    nav NUMERIC(15,2) NOT NULL,
    net_irr NUMERIC(5,2) NOT NULL,
    tvpi NUMERIC(4,2) NOT NULL,
    dpi NUMERIC(4,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial real values
INSERT INTO cvc.fund_metrics (
    committed_capital,
    deployed_capital,
    nav,
    net_irr,
    tvpi,
    dpi
) VALUES (
    5000000.00,
    3200000.00,
    4500000.00,
    15.2,
    1.42,
    0.85
);