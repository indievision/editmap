# EDITMAP Local CV Microservice

High-performance local computer vision microservice for film framing taxonomy and cast character recognition.
Powered by **Ultralytics YOLO** and **InsightFace** / **face_recognition**.

Runs locally on `http://127.0.0.1:8000`.

---

## 1. Prerequisites

- Python 3.10, 3.11, or 3.12 (Python 3.11 recommended on macOS Apple Silicon)
- Virtual environment tool (`venv`)

---

## 2. Installation

1. Navigate to the `server/` directory:
   ```bash
   cd server
   ```

2. Create a virtual environment:
   ```bash
   /opt/homebrew/bin/python3.11 -m venv .venv
   ```

3. Activate the virtual environment:
   ```bash
   source .venv/bin/activate
   ```

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

---

## 3. Running the Microservice

Start the FastAPI server:
```bash
uvicorn main:app --host 127.0.0.1 --port 8000
```

The service will be live on:
- Health check: `http://127.0.0.1:8000/health`
- Interactive OpenAPI documentation: `http://127.0.0.1:8000/docs`

---

## 4. API Endpoints

### `POST /api/analyze-shot`
Analyzes a single video frame for composition, shot size, and content classification.
- **Request:**
  ```json
  {
    "image": "<base64_encoded_jpeg_or_png>"
  }
  ```
- **Response:**
  ```json
  {
    "shotSize": "CU",
    "composition": "Single person",
    "content": "People",
    "uncertain": false
  }
  ```

### `POST /api/analyze-characters`
Analyzes a candidate frame against a cast gallery with reference photos.
- **Request:**
  ```json
  {
    "image": "<base64_encoded_jpeg_or_png>",
    "cast": [
      {
        "id": "char-1",
        "name": "Anna",
        "references": [
          { "id": "ref-1", "image": "<base64_encoded_image>" }
        ]
      }
    ]
  }
  ```
- **Response:**
  ```json
  {
    "appearances": ["char-1"],
    "unresolved": false
  }
  ```
