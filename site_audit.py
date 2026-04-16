from functions.site_audit import perform_site_audit, save_audit


if __name__ == "__main__":
    report = perform_site_audit()
    save_audit(report)
