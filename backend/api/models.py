"""
Unmanaged Django models for the existing cvc schema.

All models have managed = False — Django reads/queries them but never creates
or migrates the underlying tables. Schema is set via search_path in settings.py.
"""

from django.contrib.postgres.fields import ArrayField
from django.db import models


class Company(models.Model):
    name = models.TextField()
    website = models.TextField(null=True, blank=True)
    one_liner = models.TextField(null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    sector = models.TextField(null=True, blank=True)
    subsector = models.TextField(null=True, blank=True)
    stage = models.TextField(null=True, blank=True)
    company_type = models.TextField(null=True, blank=True)
    business_model = models.TextField(null=True, blank=True)
    founded = models.IntegerField(null=True, blank=True)
    employee_count = models.IntegerField(null=True, blank=True)
    hq_city = models.TextField(null=True, blank=True)
    hq_state = models.TextField(null=True, blank=True)
    hq_country = models.TextField(null=True, blank=True)
    location = models.TextField(null=True, blank=True)
    investors = ArrayField(models.TextField(), default=list, blank=True)
    tags = ArrayField(models.TextField(), default=list, blank=True)
    verticals = ArrayField(models.TextField(), default=list, blank=True)
    is_hardware = models.BooleanField(default=False)
    is_software = models.BooleanField(default=False)
    enrichment_status = models.TextField(default="pending")
    enrichment_source = models.TextField(null=True, blank=True)
    enrichment_confidence = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    enriched_at = models.DateTimeField(null=True, blank=True)
    raised_total = models.BigIntegerField(null=True, blank=True)
    raised_usd_m = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    last_round_date = models.DateField(null=True, blank=True)
    last_round_stage = models.TextField(null=True, blank=True)
    score_composite = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=False)
    updated_at = models.DateTimeField(auto_now=False)

    class Meta:
        managed = False
        db_table = "companies"

    def __str__(self):
        return self.name


class Partner(models.Model):
    name = models.TextField()
    industry = models.TextField(null=True, blank=True)
    contact_name = models.TextField(null=True, blank=True)
    contact_email = models.TextField(null=True, blank=True)
    challenge_areas = ArrayField(models.TextField(), default=list, blank=True, null=True)
    sectors_of_interest = ArrayField(models.TextField(), default=list, blank=True, null=True)
    environments = ArrayField(models.TextField(), default=list, blank=True, null=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=False)
    updated_at = models.DateTimeField(auto_now=False)

    class Meta:
        managed = False
        db_table = "partners"

    def __str__(self):
        return self.name


class User(models.Model):
    username = models.TextField(unique=True)
    password_hash = models.TextField()
    role = models.TextField()
    full_name = models.TextField(null=True, blank=True)
    email = models.TextField(null=True, blank=True)
    assigned_partner_ids = ArrayField(models.IntegerField(), default=list)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=False)
    updated_at = models.DateTimeField(auto_now=False)

    class Meta:
        managed = False
        db_table = "users"

    def __str__(self):
        return self.username


class PartnerMatch(models.Model):
    partner = models.ForeignKey(Partner, on_delete=models.DO_NOTHING, null=True)
    company = models.ForeignKey(Company, on_delete=models.DO_NOTHING, null=True)
    match_score = models.IntegerField(null=True, blank=True)
    match_reason = models.TextField(null=True, blank=True)
    status = models.TextField(default="suggested")
    created_at = models.DateTimeField(auto_now_add=False)

    class Meta:
        managed = False
        db_table = "partner_matches"
        unique_together = [("partner", "company")]


class CompanyLifecycle(models.Model):
    company = models.ForeignKey(Company, on_delete=models.DO_NOTHING)
    stage = models.TextField()
    status = models.TextField(default="active")
    priority = models.TextField(default="medium")
    assigned_to = models.ForeignKey(
        User, on_delete=models.DO_NOTHING, null=True, blank=True, db_column="assigned_to"
    )
    source = models.TextField(null=True, blank=True)
    entered_at = models.DateTimeField()
    exited_at = models.DateTimeField(null=True, blank=True)
    target_close_date = models.DateField(null=True, blank=True)
    investment_amount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=False)
    updated_at = models.DateTimeField(auto_now=False)

    class Meta:
        managed = False
        db_table = "company_lifecycle"


class PartnerDocument(models.Model):
    partner = models.ForeignKey(Partner, on_delete=models.DO_NOTHING)
    filename = models.CharField(max_length=255)
    file_type = models.CharField(max_length=50)
    file_data = models.BinaryField()
    file_size = models.IntegerField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=False)
    uploaded_by = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        managed = False
        db_table = "partner_documents"
