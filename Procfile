# ClauseIQ process model:
# - web AND worker must both run (PDFs stay pending without worker).
# - Keep web as a SINGLE uvicorn process — in-memory auth/access cache
#   (TB-20) is not safe across --workers N or multiple web replicas.
web: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
worker: python -m backend.workers.pdf_worker
