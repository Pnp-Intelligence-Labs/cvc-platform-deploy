-- Migration 032: Normalize sector values to Title Case
-- Consolidates snake_case variants with their Title Case equivalents

UPDATE cvc.companies SET sector = 'Supply Chain'         WHERE sector = 'supply_chain';
UPDATE cvc.companies SET sector = 'Robotics'             WHERE sector = 'robotics';
UPDATE cvc.companies SET sector = 'Manufacturing'        WHERE sector = 'manufacturing';
UPDATE cvc.companies SET sector = 'Energy'               WHERE sector = 'energy';
UPDATE cvc.companies SET sector = 'Materials'            WHERE sector = 'materials';
UPDATE cvc.companies SET sector = 'Climate'              WHERE sector = 'climate';
UPDATE cvc.companies SET sector = 'Other'                WHERE sector = 'other';
