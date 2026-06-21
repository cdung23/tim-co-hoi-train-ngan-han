# Hướng dẫn triển khai và Publish ứng dụng (Deployment Guide)

Dự án **Tìm cơ hội train ngắn hạn** (phân tích kỹ thuật cổ phiếu) bao gồm 2 thành phần chính:
1. **Frontend (Giao diện người dùng):** Sử dụng HTML, CSS và JavaScript thuần (nằm trong thư mục `frontend/`).
2. **Backend (API xử lý dữ liệu):** Sử dụng Python với thư viện FastAPI (nằm trong thư mục `backend/`).

Dưới đây là các phương án để bạn chạy ứng dụng local hoặc publish online lên Internet.

---

## Phương án 1: Chạy Local trên máy tính cá nhân (Khuyên dùng)

Đây là cách nhanh nhất và ổn định nhất để sử dụng vì nguồn dữ liệu `VNStock` đôi khi chặn các dải IP nước ngoài (như của các hosting Render, Vercel).

### Bước 1: Khởi động Backend
1. Đảm bảo máy của bạn đã cài đặt Python (phiên bản 3.9 trở lên).
2. Mở terminal tại thư mục dự án và cài đặt các thư viện cần thiết:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Chạy file khởi động backend bằng cách click đúp vào tệp `start.bat` trong thư mục `backend/` hoặc chạy lệnh:
   ```bash
   python main.py
   ```
   *Backend sẽ chạy tại địa chỉ: `http://localhost:8000`*

### Bước 2: Chạy Frontend
* **Cách đơn giản:** Bạn chỉ cần mở trực tiếp file `frontend/index.html` bằng trình duyệt web (Chrome, Edge, Firefox, v.v.).
* **Cách chuyên nghiệp (tránh lỗi CORS cục bộ):**
  Bạn chạy một máy chủ tĩnh mini bằng Python tại thư mục gốc:
  ```bash
  python -m http.server 3000
  ```
  Sau đó truy cập: `http://localhost:3000/frontend/` trên trình duyệt.

---

## Phương án 2: Publish Online lên Internet (Miễn phí)

Để đưa ứng dụng lên mạng internet cho người khác truy cập, bạn cần deploy riêng biệt cả Frontend và Backend.

### Bước 1: Deploy Backend (FastAPI Python)
Bạn cần đưa mã nguồn Python lên một máy chủ có hỗ trợ chạy Python 24/7.
* **Các nền tảng hỗ trợ miễn phí/giá rẻ:**
  * **Render.com** (Khuyên dùng cho người mới bắt đầu)
  * **Railway.app**
  * **VPS riêng (DigitalOcean, Vultr, Vietnix, v.v.):** Khuyên dùng VPS Việt Nam để tránh VNStock chặn IP nước ngoài.
* **Cách deploy lên Render:**
  1. Đăng nhập Render bằng tài khoản GitHub của bạn.
  2. Tạo một **New Web Service** và liên kết với repository GitHub `tim-co-hoi-train-ngan-han`.
  3. Cấu hình cài đặt:
     * **Root Directory:** `backend`
     * **Runtime:** `Python`
     * **Build Command:** `pip install -r requirements.txt`
     * **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
  4. Sau khi deploy thành công, Render sẽ cung cấp cho bạn một URL Public (ví dụ: `https://my-backend-service.onrender.com`).

### Bước 2: Cập nhật địa chỉ Backend ở Frontend
Trước khi publish frontend, bạn phải chỉnh sửa để JavaScript kết nối tới Backend online thay vì `localhost`.
1. Mở file [frontend/app.js](file:///e:/Antygraviti/app-phan-tich-ky-thuat-moi/frontend/app.js).
2. Sửa dòng thứ 6:
   ```javascript
   // Thay 'http://localhost:8000' bằng URL của Backend online bạn vừa deploy
   const API_BASE = 'https://my-backend-service.onrender.com'; 
   ```
3. Commit và push thay đổi này lên GitHub:
   ```bash
   git add frontend/app.js
   git commit -m "Update API base URL for deployment"
   git push origin main
   ```

### Bước 3: Deploy Frontend lên GitHub Pages
GitHub cung cấp tính năng **GitHub Pages** giúp bạn lưu trữ web tĩnh miễn phí.
1. Truy cập vào kho chứa GitHub của bạn: `https://github.com/cdung23/tim-co-hoi-train-ngan-han`.
2. Chọn mục **Settings** (Cài đặt) -> **Pages** ở danh sách bên trái.
3. Ở phần **Build and deployment**:
   * **Source:** Chọn `Deploy from a branch`.
   * **Branch:** Chọn nhánh `main` và thư mục `/ (root)`.
4. Nhấn **Save**.
5. Đợi khoảng 1-2 phút, GitHub sẽ tạo đường dẫn trang web của bạn. Địa chỉ web sẽ có định dạng:
   `https://cdung23.github.io/tim-co-hoi-train-ngan-han/frontend/`
