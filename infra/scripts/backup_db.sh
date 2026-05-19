#!/bin/bash
BACKUP_DIR=/backups
DB=cvc_db
USER=producer
REFINERY=nathan@100.114.250.70

mkdir -p $BACKUP_DIR

echo "[$(date)] Starting backup of $DB"
: "${CVC_DB_PASSWORD:?CVC_DB_PASSWORD is required}"
PGPASSWORD="$CVC_DB_PASSWORD" pg_dump -h localhost -U $USER $DB | gzip > $BACKUP_DIR/${DB}_$(date +%Y%m%d).sql.gz

if [ $? -eq 0 ]; then
    SIZE=$(du -sh $BACKUP_DIR/${DB}_$(date +%Y%m%d).sql.gz | cut -f1)
    echo "[$(date)] Backup complete: ${DB}_$(date +%Y%m%d).sql.gz ($SIZE)"
else
    echo "[$(date)] ERROR: Backup failed"
    exit 1
fi

# Keep last 7 days locally
find $BACKUP_DIR -name "${DB}_*.sql.gz" -mtime +7 -delete
echo "[$(date)] Old backups pruned"

# Rsync to Refinery
rsync -az $BACKUP_DIR/ $REFINERY:~/db_backups/ && echo "[$(date)] Rsync to Refinery complete" || echo "[$(date)] WARNING: Rsync to Refinery failed"
