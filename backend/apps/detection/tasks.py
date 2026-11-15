from celery import shared_task

from .models import Job


@shared_task(name="skyscan.run_job", acks_late=True)
def run_job(job_id: str) -> str:
    """Run a measure or change job. Every job goes through this one task."""
    job = Job.objects.get(pk=job_id)
    if job.mode == Job.Mode.CHANGE:
        from apps.change.services import run_change_job

        job = run_change_job(job_id)
    else:
        from .services import run_measure_job

        job = run_measure_job(job_id)
    return job.status
