# Investor Technical Q&A

**Company:** _____________________  
**Date:** _____________________  
**Completed by:** _____________________ (Founder/CTO)

---

## Instructions

This questionnaire helps investors assess your engineering practices and technical risk. Answer each question concisely — bullet points are fine. If a question does not apply, write "N/A".

**Scoring:** Your answers will be scored against a 126-point rubric across 9 technical categories.

---

## 1. CODE HISTORY & OWNERSHIP

**Q1.1** — Who wrote your core software? (check all that apply)
- [ ] All coded in-house by employees
- [ ] Some non-core parts outsourced
- [ ] Some core parts outsourced
- [ ] Everything outsourced
- [ ] Open source / third-party APIs heavily used

**Details:** ___________________________________________

**Q1.2** — Is your original/founding developer still the main developer?
- [ ] Yes, original developer still leads
- [ ] No, transitioned to new team
- [ ] Original developer left the company

**Q1.3** — Has your founding team built similar products before?
- [ ] Yes, this is our second+ product in this domain
- [ ] Some team members have relevant experience
- [ ] First time building this type of product

**Q1.4** — Knowledge distribution: How many people understand each critical subsystem?
- [ ] Every critical subsystem has 2+ knowledgeable owners
- [ ] Some systems have single points of failure
- [ ] Critical knowledge held by only 1 person (with equity)
- [ ] Critical knowledge held by only 1 person (no equity)

---

## 2. AGILITY & RELEASE PRACTICES

**Q2.1** — How often do you deploy to production?
- [ ] Continuous deployment (multiple times daily)
- [ ] Daily
- [ ] Weekly
- [ ] Monthly
- [ ] A few times per year
- [ ] Once per year or less

**Q2.2** — For "build vs buy" decisions, what do you evaluate?
- [ ] Engineering hours to build AND maintain vs buy cost
- [ ] Build hours only (not ongoing maintenance)
- [ ] We build everything first, evaluate later
- [ ] We buy first, build only if necessary

**Q2.3** — What payment system do you use?
- [ ] Stripe
- [ ] Braintree
- [ ] Other third-party (specify): ___________
- [ ] Custom in-house built

**Q2.4** — Do any clients pay outside your standard payment system?
- [ ] No, all payments through standard system
- [ ] Yes, some clients pay via invoice/manual process
- [ ] Yes, significant revenue outside standard system

**Q2.5** — How do you handle invoicing?
- [ ] Third-party system (QuickBooks, Stripe, etc.)
- [ ] Custom in-house solution
- [ ] Manual process

---

## 3. MONITORING & OBSERVABILITY

**Q3.1** — Which monitoring do you have in place? (check all that apply)
- [ ] Application performance monitoring (APM)
- [ ] Application security monitoring
- [ ] Infrastructure performance monitoring
- [ ] Website/uptime monitoring
- [ ] Exception/error tracking
- [ ] None of the above yet

**Q3.2** — Are your monitoring tools:
- [ ] Third-party SaaS (Datadog, New Relic, Sentry, etc.)
- [ ] Internally developed/custom built
- [ ] Mix of both

**Q3.3** — Have you measured your maximum system capacity?
- [ ] Yes, we know our breaking point and scaling limits
- [ ] We have estimates but no formal testing
- [ ] No, not measured

---

## 4. COMPLIANCE & SECURITY

**Q4.1** — Third-party data sources: How do you acquire external data?
- [ ] All licensed through proper contracts
- [ ] Some web crawling (non-critical data only)
- [ ] Web crawling includes business-critical data
- [ ] No third-party data used

**Q4.2** — How do you monitor open-source library licenses?
- [ ] Automated tooling (Snyk, FOSSA, etc.)
- [ ] Manual review during dependency updates
- [ ] Server/desktop only, not production code
- [ ] Not formally monitored

**Q4.3** — Version control backups:
- [ ] Cloud-hosted (GitHub, GitLab, Bitbucket)
- [ ] Self-hosted with automated backups to third-party
- [ ] Local only, no third-party backup
- [ ] Not using version control

**Q4.4** — Database disaster recovery: What data loss is possible in a worst-case scenario?
- [ ] 0% — real-time replication, no data loss possible
- [ ] <1 hour of data loss (regular snapshots)
- [ ] <24 hours of data loss (daily backups)
- [ ] Up to 50% of data could be lost
- [ ] 100% data loss possible (no backups)

**Q4.5** — Do you have a documented disaster recovery plan?
- [ ] Yes, documented and tested
- [ ] Yes, documented but not tested
- [ ] Informal knowledge only
- [ ] No disaster recovery plan

---

## 5. PRODUCT DEVELOPMENT & PROCESSES

**Q5.1** — Version control setup:
- [ ] Cloud-hosted (GitHub, GitLab, Bitbucket)
- [ ] Self-hosted (local server)
- [ ] No version control

**Q5.2** — Testing practices:
- [ ] Unit tests for critical routines only
- [ ] 100% code coverage requirement
- [ ] Integration/E2E tests only
- [ ] No automated tests

**Q5.3** — Code review process:
- [ ] All critical code reviewed by second person
- [ ] All code reviewed
- [ ] Pair programming (continuous review)
- [ ] No formal code review

**Q5.4** — Deployment process:
- [ ] One-click deploy to staging and production
- [ ] Automated to staging, manual to production
- [ ] Multi-step manual process
- [ ] Complex, error-prone deployment

**Q5.5** — Feature flags:
- [ ] Yes, we use a feature flag system
- [ ] No, we deploy code to show features

**Q5.6** — Can you show features to limited users without deploying new code?
- [ ] Yes, via feature flags or config
- [ ] No, requires code deployment

**Q5.7** — Hosting infrastructure:
- [ ] Multi-cloud or mix of IaaS providers
- [ ] Single IaaS (AWS, GCP, Azure)
- [ ] PaaS only (Heroku, Vercel, etc.)
- [ ] On-premise / self-hosted

**Q5.8** — Background job processing:
- [ ] Heavy cron jobs or scheduled tasks
- [ ] Queue-based job system (SQS, Celery, etc.)
- [ ] Lightweight / minimal background processing
- [ ] No background jobs

**Q5.9** — Third-party provider stability:
- [ ] All providers are well-funded/stable companies
- [ ] Some smaller/less-funded providers
- [ ] Heavy reliance on small providers/startups

---

## 6. TECH ORGANIZATION & PROCESS

**Q6.1** — Who owns the product roadmap?
- [ ] Chief Product Officer (CPO)
- [ ] CEO
- [ ] CTO
- [ ] Founding team collectively
- [ ] No formal roadmap owner

**Q6.2** — How often does the CTO speak directly with customers?
- [ ] Weekly (calls/meetings)
- [ ] Weekly (tickets/support only)
- [ ] Monthly
- [ ] Rarely / Never

**Q6.3** — How often do engineers speak with customers?
- [ ] Weekly (calls/meetings)
- [ ] Weekly (tickets/support)
- [ ] CTO handles all customer contact
- [ ] Rarely / Never

**Q6.4** — Do you have power users available for feedback?
- [ ] Yes, dedicated power user program
- [ ] Some engaged users we can reach
- [ ] No formal power user relationships

**Q6.5** — Roadmap visibility:
- [ ] Public roadmap visible to customers
- [ ] Internal roadmap visible to all employees
- [ ] Only tech team sees roadmap
- [ ] Only leadership sees roadmap
- [ ] No written roadmap (founder head only)

---

## 7. TECH FOUNDER LEADERSHIP

**Q7.1** — Can the technical founder convincingly pitch the product to investors?
- [ ] Yes, founder is strong presenter
- [ ] Moderate ability
- [ ] Struggles with investor-facing communication

**Q7.2** — When was the last customer conversation for the technical founder?
- [ ] This week
- [ ] This month
- [ ] 1-3 months ago
- [ ] More than 3 months ago
- [ ] Never

**Q7.3** — Product roadmap planning horizon:
- [ ] 12+ months planned in detail
- [ ] 6 months planned ahead
- [ ] 1-3 months planned
- [ ] Less than 1 month planned
- [ ] No written roadmap

**Q7.4** — Are your engineering values/culture documented?
- [ ] Yes, written engineering values
- [ ] Informal understanding only
- [ ] No documented values

---

## 8. HIRING & TEAM BUILDING

**Q8.1** — Prior working relationships:
- [ ] All developers worked for/with founder before
- [ ] Most developers have prior relationship
- [ ] Some developers have prior relationship
- [ ] No prior relationships

**Q8.2** — Equity distribution:
- [ ] All developers have equity
- [ ] Most developers have equity
- [ ] Some developers have equity
- [ ] Only founders have equity

**Q8.3** — Hiring sources:
- [ ] All new hires from referrals
- [ ] Most from referrals
- [ ] Some from referrals
- [ ] No referrals (job boards, recruiters only)

**Q8.4** — Interview process includes: (check all that apply)
- [ ] Team interview (meet the team)
- [ ] Live coding exercise
- [ ] Take-home project
- [ ] Reference calls

**Q8.5** — Reference checks:
- [ ] Backdoor references (people we know in common)
- [ ] Provided references only
- [ ] No reference calls

---

## 9. PEOPLE MANAGEMENT

**Q9.1** — Engineering team attrition in the last 12 months:
- [ ] No departures
- [ ] 1 departure
- [ ] 2+ departures
- [ ] Complete team turnover

**Q9.2** — If people left, primary reason:
- [ ] Better opportunity / career growth
- [ ] Salary
- [ ] Lack of motivation / engagement
- [ ] Founder/management issues

**Q9.3** — One-on-one meeting frequency:
- [ ] Daily standups include personal check-in
- [ ] Weekly 1:1s
- [ ] Monthly 1:1s
- [ ] Quarterly or less
- [ ] Never

---

## ADDITIONAL NOTES

**Biggest technical risk:** ___________________________________________

**Biggest technical strength:** ___________________________________________

**What would break if you 10x customer base tomorrow?** ___________________________________________

**Technical debt you are aware of:** ___________________________________________

---

**Founder/CTO Signature:** _____________________  
**Date:** _____________________
