from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import HTTPException

from src.config import Settings


class LMSClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.lms_base_url.rstrip("/")
        self.timeout = httpx.Timeout(12.0, connect=4.0)

    def _service_headers(self) -> dict[str, str]:
        if not self.settings.pacewise_api_key.strip():
            raise HTTPException(status_code=503, detail="PACEWISE_API_KEY is not configured")
        return {"X-PaceWise-Key": self.settings.pacewise_api_key}

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                response = await client.request(method, path, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise HTTPException(status_code=503, detail="LMS simulator is unavailable") from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="LMS simulator timed out") from exc
        if response.status_code in {401, 403}:
            detail = response.json().get("detail", "LMS authorization failed") if response.content else "LMS authorization failed"
            raise HTTPException(status_code=response.status_code, detail=detail)
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"LMS request failed ({response.status_code})")
        return response

    async def verify_launch(self, token: str) -> dict:
        response = await self._request(
            "POST",
            "/api/pacewise/v1/launch/verify",
            headers=self._service_headers(),
            json={"token": token},
        )
        return response.json()

    async def service_get(self, path: str, params: dict | None = None):
        response = await self._request("GET", path, headers=self._service_headers(), params=params)
        return response.json()

    async def login_and_create_launch(self, email: str, password: str, course_id: int | None = None) -> dict:
        login = await self._request("POST", "/api/session", json={"email": email, "password": password})
        payload = login.json()
        access_token = payload["access_token"]
        csrf_token = payload["csrf_token"]
        headers = {"Authorization": f"Bearer {access_token}", "X-CSRF-Token": csrf_token}
        try:
            courses_response = await self._request("GET", "/api/v1/courses", headers=headers)
            courses = courses_response.json()
            if not courses:
                raise HTTPException(status_code=403, detail="This LMS account has no enrolled courses")
            selected_id = course_id if course_id is not None else int(courses[0]["id"])
            if selected_id not in {int(course["id"]) for course in courses}:
                raise HTTPException(status_code=403, detail="Course enrollment required")
            launch = await self._request(
                "POST",
                f"/api/pacewise/launch/{selected_id}",
                headers=headers,
            )
            parsed_launch = urlparse(launch.json()["launch_url"])
            launch_query = parsed_launch.query
            if not launch_query and "?" in parsed_launch.fragment:
                launch_query = parsed_launch.fragment.split("?", 1)[1]
            token = parse_qs(launch_query).get("token", [""])[0]
            if not token:
                raise HTTPException(status_code=502, detail="LMS returned an invalid launch URL")
            return await self.verify_launch(token)
        finally:
            try:
                await self._request("DELETE", "/api/session", headers=headers)
            except HTTPException:
                pass
