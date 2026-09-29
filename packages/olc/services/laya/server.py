"""olc's small HTTP adapter for Laya's typed decision router."""

from importlib.metadata import version
import logging
import os
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from laya import Router
from pydantic import BaseModel, Field
import torch

logger = logging.getLogger("olc.laya")
DEVICE = os.environ.get("LAYA_DEVICE", "cpu")
THREADS = int(os.environ.get("LAYA_THREADS", "4"))
if THREADS > 0:
    torch.set_num_threads(THREADS)

PRELOAD = os.environ.get("LAYA_PRELOAD", "0").lower() in {"1", "true", "yes"}
ROUTER = Router(device=DEVICE, preload=PRELOAD)
PREDICTION_LOCK = Lock()
LAYA_VERSION = version("laya")
app = FastAPI(title="olc Laya server", version=LAYA_VERSION)


class SystemOneRequest(BaseModel):
    state: Any
    questions: dict[str, Any]
    model: str | None = None
    task: str | None = None
    lang: str | None = None
    lang_guess: str | None = None
    max_len: int | None = Field(default=None, ge=1, le=8192)
    head_max_len: int | None = Field(default=None, ge=1, le=8192)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "laya",
        "version": LAYA_VERSION,
        "device": DEVICE,
    }


@app.post("/v1/systemone")
def systemone(request: SystemOneRequest) -> dict[str, Any]:
    if not request.questions:
        raise HTTPException(status_code=422, detail="questions must not be empty")
    if len(request.questions) > 64:
        raise HTTPException(status_code=413, detail="at most 64 questions are allowed")

    options = {
        key: value
        for key, value in {
            "model": request.model,
            "task": request.task,
            "lang": request.lang,
            "lang_guess": request.lang_guess,
            "max_len": request.max_len,
            "head_max_len": request.head_max_len,
        }.items()
        if value is not None
    }
    try:
        with PREDICTION_LOCK:
            return ROUTER.predict(request.state, request.questions, **options)
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("Laya inference failed")
        raise HTTPException(status_code=503, detail="Laya inference failed") from error
