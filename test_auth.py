import requests
import json
import time

BASE_URL = "http://localhost:8000/user"

# 创建一个 Session 对象，它会自动处理 Cookies (Session ID)
session = requests.Session()

def print_response(response, action):
    print(f"--- {action} ---")
    print(f"Status Code: {response.status_code}")
    try:
        print(f"Response: {json.dumps(response.json(), indent=2)}")
    except:
        print(f"Response: {response.text}")
    print("-" * 20)

def test_full_auth_flow():
    username = f"testuser_{int(time.time())}"
    password = "password123"
    new_password = "newpassword123"
    name = "Test User"
    new_name = "Updated Name"

    # 1. 注册 (Register)
    print(f"\n[1] Registering user: {username}")
    res = session.post(f"{BASE_URL}/register", json={
        "username": username,
        "password": password,
        "name": name
    })
    print_response(res, "Register")
    if res.status_code != 201: return

    # 2. 登录 (Login)
    print(f"\n[2] Logging in as: {username}")
    res = session.post(f"{BASE_URL}/login", json={
        "username": username,
        "password": password
    })
    print_response(res, "Login")
    if res.status_code != 200: return

    # 3. 验证 Session (Validate)
    print(f"\n[3] Validating Session (Check Name)")
    res = session.get(f"{BASE_URL}/validate")
    print_response(res, "Validate")
    if res.json().get('user', {}).get('name') != name:
        print("Error: Name mismatch!")

    # 4. 更新用户名 (Update Name)
    print(f"\n[4] Updating Name to: {new_name}")
    res = session.put(f"{BASE_URL}/update/username/{username}", json={
        "name": new_name
    })
    print_response(res, "Update Name")

    # 5. 再次验证 (Validate) - 检查 Session 中的名字是否更新
    print(f"\n[5] Validating Session (Check Updated Name)")
    res = session.get(f"{BASE_URL}/validate")
    print_response(res, "Validate")
    if res.json().get('user', {}).get('name') != new_name:
        print("Error: Updated name mismatch in session!")

    # 6. 更新密码 (Update Password)
    print(f"\n[6] Updating Password")
    res = session.put(f"{BASE_URL}/update/password/{username}", json={
        "password": new_password
    })
    print_response(res, "Update Password")

    # 7. 登出 (Logout)
    print(f"\n[7] Logging out")
    res = session.post(f"{BASE_URL}/logout")
    print_response(res, "Logout")

    # 8. 尝试用旧密码登录 (Login Old Pass) - 应该失败
    print(f"\n[8] Login with OLD password (Should Fail)")
    res = session.post(f"{BASE_URL}/login", json={
        "username": username,
        "password": password
    })
    print_response(res, "Login (Old Pass)")
    if res.status_code != 401:
        print("Error: Old password should not work!")

    # 9. 用新密码登录 (Login New Pass) - 应该成功
    print(f"\n[9] Login with NEW password (Should Success)")
    res = session.post(f"{BASE_URL}/login", json={
        "username": username,
        "password": new_password
    })
    print_response(res, "Login (New Pass)")
    if res.status_code != 200: return

    # 10. 删除用户 (Delete User)
    print(f"\n[10] Deleting User")
    res = session.delete(f"{BASE_URL}/delete/{username}", json={
        "password": new_password
    })
    print_response(res, "Delete User")

    # 11. 再次尝试登录 (Login Deleted User) - 应该失败
    print(f"\n[11] Login with Deleted User (Should Fail)")
    res = session.post(f"{BASE_URL}/login", json={
        "username": username,
        "password": new_password
    })
    print_response(res, "Login (Deleted User)")
    if res.status_code != 404:
        print("Error: Deleted user should not be found!")

if __name__ == "__main__":
    try:
        test_full_auth_flow()
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to server. Make sure 'node server.js' is running!")
