from pydantic import BaseModel


class PasswordResetRequest(BaseModel):
    email: str


class PasswordOtpVerify(BaseModel):
    email: str
    otp: str


class PasswordResetConfirm(BaseModel):
    email: str
    reset_token: str
    new_password: str
    confirm_password: str

class UserCreate(BaseModel):
    username: str
    email: str
    phone: str
    password: str

class UserLogin(BaseModel):
    username: str
    phone: str | None = None
    password: str
