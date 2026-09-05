import urllib.request
import json

samples = ['clear_passport', 'low_quality_doc', 'missing_field_doc', 'multipage_pdf', 'mrz_inconsistent']

for s in samples:
    url = f"http://127.0.0.1:8000/api/ocr/demo-sample/{s}"
    req = urllib.request.Request(url, data=b"", method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print(f"=== {s.upper()} ===")
            print("Status:", data["status"])
            print("Doc Type:", data["fields"]["document_type"]["value"])
            name_val = data["fields"]["full_name"]["value"]
            name_conf = data["fields"]["full_name"]["confidence"]
            print(f"Full Name: {name_val} ({name_conf*100:.0f}%)")
            print("Doc Number:", data["fields"]["document_number"]["value"])
            print("DOB:", data["fields"]["date_of_birth"]["value"])
            print("Expiry:", data["fields"]["expiry_date"]["value"])
            print("Quality Status:", data["quality_assessment"]["status"], "Quality Conf:", data["quality_assessment"]["confidence"])
            print("MRZ Consistency:", data["mrz_consistency"])
            print()
    except Exception as e:
        print(f"Error on {s}: {e}")
