"""
proxycurl.py — LinkedIn profile enrichment via Proxycurl API.

Structured LinkedIn data without scraping blocks.
Cost: ~$0.01 per profile lookup.

Usage:
    from web.proxycurl import get_profile, search_profile

    # Lookup by LinkedIn URL
    profile = get_profile("https://www.linkedin.com/in/williamhgates/")

    # Search by name + company
    profile = search_profile("Satya Nadella", company="Microsoft")
"""

import time

import requests
from cvc_config import PROXYCURL_API_KEY, PROXYCURL_URL
from monitor.tracker import track

# Cache to avoid re-fetching same profiles in one session
_profile_cache = {}

_RETRY_DELAYS = [2, 5, 10]


def _extract_linkedin_id(url: str) -> str | None:
    """Extract LinkedIn ID from various URL formats."""
    url = url.strip().rstrip('/')
    # Handle linkedin.com/in/username and linkedin.com/in/username/detail
    if '/in/' in url:
        parts = url.split('/in/')
        if len(parts) > 1:
            return parts[1].split('/')[0].split('?')[0]
    return None


@track("proxycurl")
def get_profile(linkedin_url: str, use_cache: bool = True) -> dict:
    """
    Fetch LinkedIn profile by URL via Proxycurl.

    Args:
        linkedin_url: Full LinkedIn URL or just the username
        use_cache: Use in-memory cache to avoid re-fetching

    Returns:
        dict with profile data or error info:
        {
            "found": True/False,
            "profile": {...} or None,
            "error": None or error message,
            "linkedin_url": original URL,
            "cost_incurred": 0.01 or 0
        }
    """
    cache_key = linkedin_url.lower().strip()

    if use_cache and cache_key in _profile_cache:
        return _profile_cache[cache_key]

    linkedin_id = _extract_linkedin_id(linkedin_url) or linkedin_url

    # Build API URL
    url = f"{PROXYCURL_URL}/v2/linkedin"
    headers = {"Authorization": f"Bearer {PROXYCURL_API_KEY}"}
    params = {"linkedin_profile_url": f"https://www.linkedin.com/in/{linkedin_id}/"}

    error_msg = "rate limited (HTTP 429)"  # default if every retry hits 429
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)

        try:
            resp = requests.get(url, headers=headers, params=params, timeout=30)

            if resp.status_code == 200:
                data = resp.json()
                result = {
                    "found": True,
                    "profile": data,
                    "error": None,
                    "linkedin_url": linkedin_url,
                    "cost_incurred": 0.01
                }
                if use_cache:
                    _profile_cache[cache_key] = result
                return result

            elif resp.status_code == 404:
                result = {
                    "found": False,
                    "profile": None,
                    "error": "Profile not found",
                    "linkedin_url": linkedin_url,
                    "cost_incurred": 0.01
                }
                if use_cache:
                    _profile_cache[cache_key] = result
                return result

            elif resp.status_code == 429:
                # Rate limited, retry
                continue
            else:
                error_msg = f"HTTP {resp.status_code}: {resp.text[:200]}"

        except requests.Timeout:
            error_msg = "Request timeout"
        except Exception as e:
            error_msg = f"Error: {str(e)}"

    # All retries exhausted
    result = {
        "found": False,
        "profile": None,
        "error": f"Failed after retries: {error_msg}",
        "linkedin_url": linkedin_url,
        "cost_incurred": 0
    }
    return result


@track("proxycurl_search")
def search_profile(name: str, company: str = None, title: str = None) -> dict:
    """
    Search for LinkedIn profile by name + optional company/title.
    Returns first matching profile or None.
    """
    url = f"{PROXYCURL_URL}/v2/linkedin/profile/resolve"
    headers = {"Authorization": f"Bearer {PROXYCURL_API_KEY}"}

    name_parts = name.split()
    if not name_parts:
        return {
            "found": False,
            "profile": None,
            "error": "Name is required for search",
            "search_params": {},
            "cost_incurred": 0,
        }
    params = {"first_name": name_parts[0]}
    if len(name_parts) > 1:
        params["last_name"] = name_parts[-1]
    if company:
        params["company_domain"] = company  # Proxycurl prefers domain
    if title:
        params["title"] = title

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30)

        if resp.status_code == 200:
            data = resp.json()
            if data.get("linkedin_profile_url"):
                # Found profile, now fetch full details
                return get_profile(data["linkedin_profile_url"])
            else:
                return {
                    "found": False,
                    "profile": None,
                    "error": "No matching profile found",
                    "search_params": params,
                    "cost_incurred": 0.01  # Search still costs
                }
        else:
            return {
                "found": False,
                "profile": None,
                "error": f"Search failed: HTTP {resp.status_code}",
                "search_params": params,
                "cost_incurred": 0
            }

    except Exception as e:
        return {
            "found": False,
            "profile": None,
            "error": f"Search error: {str(e)}",
            "search_params": params,
            "cost_incurred": 0
        }


def extract_linkedin_urls(text: str) -> list[str]:
    """Extract all LinkedIn profile URLs from text."""
    import re
    pattern = r'https?://(?:www\.)?linkedin\.com/in/[a-zA-Z0-9_-]+'
    matches = re.findall(pattern, text, re.IGNORECASE)
    # Deduplicate and clean
    seen = set()
    cleaned = []
    for url in matches:
        normalized = url.lower().rstrip('/')
        if normalized not in seen:
            seen.add(normalized)
            cleaned.append(url)
    return cleaned


def format_profile_for_llm(profile: dict) -> str:
    """Convert Proxycurl profile to text format for LLM consumption."""
    if not profile:
        return ""

    parts = []

    # Basic info
    full_name = profile.get("full_name", "Unknown")
    headline = profile.get("headline", "")
    parts.append(f"Name: {full_name}")
    if headline:
        parts.append(f"Headline: {headline}")

    # Current role
    occupation = profile.get("occupation", "")
    if occupation:
        parts.append(f"Current: {occupation}")

    # Experience
    experiences = profile.get("experiences", [])
    if experiences:
        parts.append("\nExperience:")
        for exp in experiences[:5]:  # Top 5 roles
            company = exp.get("company", "")
            title = exp.get("title", "")
            start = exp.get("starts_at", {})
            end = exp.get("ends_at") or {}

            start_str = f"{start.get('month', '?')}/{start.get('year', '?')}" if start else "?"
            end_str = f"{end.get('month', '?')}/{end.get('year', '?')}" if end else "Present"

            if company and title:
                parts.append(f"  • {title} at {company} ({start_str} - {end_str})")

    # Education
    education = profile.get("education", [])
    if education:
        parts.append("\nEducation:")
        for edu in education[:3]:
            school = edu.get("school", "")
            degree = edu.get("degree_name", "")
            field = edu.get("field_of_study", "")
            if school:
                edu_str = f"  • {school}"
                if degree:
                    edu_str += f", {degree}"
                if field:
                    edu_str += f" ({field})"
                parts.append(edu_str)

    return "\n".join(parts)
